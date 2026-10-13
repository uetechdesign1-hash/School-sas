-- Year-wise student enrollment history + promotion with automatic fee carry-forward.
--
-- Problem solved
--   Promotion used to overwrite students.class_id / section_id / academic_year_id.
--   Nothing remembered which class the student was in during 2025-2026, so every
--   2025-2026 receipt/bill started showing the NEW class (e.g. Class 2).
--
-- What this migration does
--   1. student_enrollments: one row per (student, academic year) holding the class
--      and section the student belonged to in THAT year.
--   2. Keeps it in sync automatically from public.students (insert/update trigger),
--      and backfills it from the current student rows.
--   3. fee_bills.class_id / section_id: snapshot of the class on the bill itself.
--   4. promote_students(): records the old-year enrollment, carries every unpaid
--      bill balance forward category-wise into the target year, then moves the
--      student to the new class/section/year. All in one transaction.

-- 1. Enrollment history -------------------------------------------------------
create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);

create index if not exists student_enrollments_school_year_idx
  on public.student_enrollments (school_id, academic_year_id);

alter table public.student_enrollments enable row level security;

drop policy if exists student_enrollments_select on public.student_enrollments;
create policy student_enrollments_select
  on public.student_enrollments
  for select
  using (
    school_id in (
      select su.school_id
      from public.school_users su
      where su.user_id = auth.uid()
        and su.is_active = true
    )
  );

-- 2. Keep enrollment in sync with students ------------------------------------
create or replace function public.sync_student_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.academic_year_id is not null and new.class_id is not null then
    insert into public.student_enrollments
      (school_id, student_id, academic_year_id, class_id, section_id)
    values
      (new.school_id, new.id, new.academic_year_id, new.class_id, new.section_id)
    on conflict (student_id, academic_year_id) do update
      set class_id = excluded.class_id,
          section_id = excluded.section_id,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_student_enrollment on public.students;
create trigger trg_sync_student_enrollment
  after insert or update of academic_year_id, class_id, section_id
  on public.students
  for each row
  execute function public.sync_student_enrollment();

-- Backfill from the students as they are today.
insert into public.student_enrollments
  (school_id, student_id, academic_year_id, class_id, section_id)
select s.school_id, s.id, s.academic_year_id, s.class_id, s.section_id
from public.students s
where s.academic_year_id is not null
  and s.class_id is not null
on conflict (student_id, academic_year_id) do nothing;

-- 3. Class snapshot on each bill ----------------------------------------------
alter table public.fee_bills
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists section_id uuid references public.sections(id) on delete set null;

update public.fee_bills b
set class_id = e.class_id,
    section_id = e.section_id
from public.student_enrollments e
where e.student_id = b.student_id
  and e.academic_year_id = b.academic_year_id
  and b.class_id is null;

create or replace function public.set_fee_bill_class_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.class_id is null then
    select e.class_id, e.section_id
      into new.class_id, new.section_id
    from public.student_enrollments e
    where e.student_id = new.student_id
      and e.academic_year_id = new.academic_year_id;

    if new.class_id is null then
      select s.class_id, s.section_id
        into new.class_id, new.section_id
      from public.students s
      where s.id = new.student_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_fee_bill_class_snapshot on public.fee_bills;
create trigger trg_set_fee_bill_class_snapshot
  before insert on public.fee_bills
  for each row
  execute function public.set_fee_bill_class_snapshot();

-- 4. Promotion with automatic carry-forward -----------------------------------
drop function if exists public.promote_students(uuid, uuid, uuid, uuid, uuid, uuid[]);

create or replace function public.promote_students(
  p_school_id uuid,
  p_from_academic_year_id uuid,
  p_to_academic_year_id uuid,
  p_to_class_id uuid,
  p_to_section_id uuid,
  p_student_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
  v_bill record;
  v_item record;
  v_from_name text;
  v_student_id uuid;
  v_lines jsonb;
  v_line_total numeric;
  v_outstanding numeric;
  v_ratio numeric;
  v_amount numeric;
  v_promoted integer := 0;
  v_carried_students integer := 0;
  v_carried_total numeric := 0;
begin
  if not exists (
    select 1
    from public.school_users su
    where su.user_id = auth.uid()
      and su.school_id = p_school_id
      and su.is_active = true
      and su.role = 'owner'
  ) then
    raise exception 'Only the Principal can promote students';
  end if;

  if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) = 0 then
    raise exception 'Select at least one student to promote';
  end if;

  if p_from_academic_year_id = p_to_academic_year_id then
    raise exception 'Target academic year must be different from the current academic year';
  end if;

  select name into v_from_name
  from public.academic_years
  where id = p_from_academic_year_id and school_id = p_school_id;

  if v_from_name is null then
    raise exception 'Source academic year was not found';
  end if;

  if not exists (
    select 1 from public.academic_years
    where id = p_to_academic_year_id and school_id = p_school_id
  ) then
    raise exception 'Target academic year was not found';
  end if;

  if not exists (
    select 1
    from public.sections sec
    join public.classes c on c.id = sec.class_id
    where sec.id = p_to_section_id
      and sec.class_id = p_to_class_id
      and c.school_id = p_school_id
  ) then
    raise exception 'Target section does not belong to the target class';
  end if;

  foreach v_student_id in array p_student_ids loop
    select * into v_student
    from public.students
    where id = v_student_id and school_id = p_school_id
    for update;

    if not found then
      raise exception 'Student % was not found in this school', v_student_id;
    end if;

    if v_student.status <> 'active'
       or v_student.academic_year_id is distinct from p_from_academic_year_id then
      raise exception 'Student % is not an active student of the source academic year',
        v_student.admission_no;
    end if;

    -- Remember the class the student had in the year being closed.
    if v_student.class_id is not null then
      insert into public.student_enrollments
        (school_id, student_id, academic_year_id, class_id, section_id)
      values
        (p_school_id, v_student.id, p_from_academic_year_id,
         v_student.class_id, v_student.section_id)
      on conflict (student_id, academic_year_id) do nothing;
    end if;

    -- Carry every unpaid bill of the closing year into the target year,
    -- category by category, so the new bill can show "Tuition - 2025-2026".
    v_amount := 0;
    for v_bill in
      select id, balance_amount
      from public.fee_bills
      where school_id = p_school_id
        and student_id = v_student.id
        and academic_year_id = p_from_academic_year_id
        and coalesce(balance_amount, 0) > 0.005
    loop
      if exists (
        select 1 from public.fee_carry_forwards cf
        where cf.source_bill_id = v_bill.id
          and cf.to_academic_year_id = p_to_academic_year_id
      ) then
        continue;
      end if;

      v_outstanding := round(v_bill.balance_amount::numeric, 2);
      v_lines := '[]'::jsonb;
      v_line_total := 0;

      for v_item in
        select i.fee_category_id,
               i.description,
               round(
                 coalesce(i.net_amount, coalesce(i.amount, 0) - coalesce(i.discount, 0))
                 - coalesce((
                     select sum(a.amount)
                     from public.fee_payment_allocations a
                     where a.fee_bill_item_id = i.id
                   ), 0),
                 2
               ) as remaining
        from public.fee_bill_items i
        where i.bill_id = v_bill.id
      loop
        if v_item.remaining > 0.005 then
          v_lines := v_lines || jsonb_build_object(
            'fee_category_id', v_item.fee_category_id,
            'category_name', coalesce(v_item.description, 'Fee'),
            'academic_year_name', v_from_name,
            'amount', v_item.remaining
          );
          v_line_total := v_line_total + v_item.remaining;
        end if;
      end loop;

      -- Reconcile category lines with the bill header balance.
      if v_line_total > v_outstanding + 0.005 then
        v_ratio := v_outstanding / v_line_total;
        select coalesce(jsonb_agg(
                 jsonb_set(e, '{amount}',
                   to_jsonb(round((e->>'amount')::numeric * v_ratio, 2)))
               ), '[]'::jsonb)
          into v_lines
        from jsonb_array_elements(v_lines) e;
      elsif v_outstanding - v_line_total > 0.005 then
        v_lines := v_lines || jsonb_build_object(
          'fee_category_id', null,
          'category_name', case when v_line_total = 0
                                then 'Unallocated fee balance'
                                else 'Other outstanding fee' end,
          'academic_year_name', v_from_name,
          'amount', round(v_outstanding - v_line_total, 2)
        );
      end if;

      perform public.create_fee_carry_forward(
        p_school_id,
        v_student.id,
        v_bill.id,
        p_to_academic_year_id,
        v_outstanding,
        '[[fee-category-carry-forward:v1]]' || jsonb_build_object('items', v_lines)::text
      );

      v_amount := v_amount + v_outstanding;
    end loop;

    if v_amount > 0 then
      v_carried_students := v_carried_students + 1;
      v_carried_total := v_carried_total + v_amount;
    end if;

    -- Move the student. The sync trigger writes the target-year enrollment.
    update public.students
    set academic_year_id = p_to_academic_year_id,
        class_id = p_to_class_id,
        section_id = p_to_section_id
    where id = v_student.id;

    v_promoted := v_promoted + 1;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'students_with_carry_forward', v_carried_students,
    'carried_forward_total', v_carried_total
  );
end;
$$;

grant execute on function public.promote_students(uuid, uuid, uuid, uuid, uuid, uuid[])
  to authenticated;

notify pgrst, 'reload schema';
