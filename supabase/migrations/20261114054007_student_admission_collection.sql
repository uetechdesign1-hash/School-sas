alter table public.students
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists parent_phone text,
  add column if not exists previous_school text,
  add column if not exists nationality text,
  add column if not exists emergency_contact text;

create table if not exists public.student_medical_details (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  medical_information text not null
);
alter table public.student_medical_details enable row level security;
revoke all on public.student_medical_details from public, anon, authenticated;
grant select, insert, update, delete on public.student_medical_details to authenticated;

drop policy if exists student_medical_details_admin on public.student_medical_details;
create policy student_medical_details_admin on public.student_medical_details
  for all to authenticated
  using (exists (
    select 1 from public.school_users su
    where su.user_id = auth.uid() and su.school_id = student_medical_details.school_id
      and su.is_active = true and lower(su.role::text) in ('owner', 'admin')
  ))
  with check (
    exists (
      select 1 from public.school_users su
      where su.user_id = auth.uid() and su.school_id = student_medical_details.school_id
        and su.is_active = true and lower(su.role::text) in ('owner', 'admin')
    )
    and exists (
      select 1 from public.students s
      where s.id = student_medical_details.student_id
        and s.school_id = student_medical_details.school_id
    )
  );

create or replace function public.create_student_admission(
  p_student jsonb,
  p_admission_fee numeric,
  p_bill_number text,
  p_receipt_number text,
  p_payment_mode text,
  p_account_id uuid,
  p_payment_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_student public.students%rowtype;
  v_student_id uuid;
  v_bill_id uuid;
  v_item_id uuid;
  v_payment jsonb;
  v_fee numeric;
begin
  if auth.uid() is null or jsonb_typeof(p_student) <> 'object' then
    raise exception 'An authenticated user and student details are required.';
  end if;

  v_student := jsonb_populate_record(null::public.students, p_student);
  if not exists (
    select 1 from public.school_users
    where user_id = auth.uid() and school_id = v_student.school_id
      and is_active = true and lower(role::text) in ('owner', 'admin')
  ) then
    raise exception 'Only active school owners and admins can create admissions.';
  end if;

  if nullif(btrim(v_student.admission_no), '') is null
    or nullif(btrim(v_student.first_name), '') is null
    or not exists (
      select 1 from public.academic_years
      where id = v_student.academic_year_id and school_id = v_student.school_id
    )
    or not exists (
      select 1 from public.classes
      where id = v_student.class_id and school_id = v_student.school_id
    )
    or not exists (
      select 1 from public.sections
      where id = v_student.section_id and class_id = v_student.class_id
        and school_id = v_student.school_id
    ) then
    raise exception 'Valid student details and school placement are required.';
  end if;

  if p_admission_fee is null or p_admission_fee::text in ('NaN', 'Infinity', '-Infinity')
    or p_admission_fee < 0
    or p_admission_fee <> round(p_admission_fee, 2) then
    raise exception 'Admission fee must be non-negative with at most two decimal places.';
  end if;
  v_fee := p_admission_fee;

  if v_fee > 0 then
    if nullif(btrim(p_bill_number), '') is null
      or nullif(btrim(p_receipt_number), '') is null
      or length(btrim(p_bill_number)) > 100
      or length(btrim(p_receipt_number)) > 100
      or p_payment_date is null then
      raise exception 'Bill number, receipt number and payment date are required.';
    end if;
    if p_payment_mode is null or p_payment_mode not in ('cash', 'bank_transfer') or not exists (
      select 1 from public.accounts
      where id = p_account_id and school_id = v_student.school_id and is_active = true
        and lower(account_type::text) = case p_payment_mode
          when 'cash' then 'cash' else 'bank' end
    ) then
      raise exception 'Select an active school account matching the payment type.';
    end if;
  end if;

  insert into public.students (
    school_id, academic_year_id, admission_no, roll_no, first_name, middle_name,
    last_name, date_of_birth, gender, class_id, section_id, admission_date,
    status, blood_group, address, city, state, postal_code, notes, father_name,
    mother_name, parent_phone, previous_school, nationality, emergency_contact
  ) values (
    v_student.school_id, v_student.academic_year_id, btrim(v_student.admission_no),
    v_student.roll_no, btrim(v_student.first_name), v_student.middle_name,
    v_student.last_name, v_student.date_of_birth, v_student.gender, v_student.class_id,
    v_student.section_id, v_student.admission_date, coalesce(v_student.status, 'active'),
    v_student.blood_group, v_student.address, v_student.city, v_student.state,
    v_student.postal_code, v_student.notes, v_student.father_name, v_student.mother_name,
    v_student.parent_phone, v_student.previous_school, v_student.nationality,
    v_student.emergency_contact
  ) returning id into v_student_id;

  if nullif(btrim(p_student->>'medical_information'), '') is not null then
    insert into public.student_medical_details (student_id, school_id, medical_information)
    values (v_student_id, v_student.school_id, btrim(p_student->>'medical_information'));
  end if;

  if v_fee > 0 then
    insert into public.fee_bills (
      school_id, student_id, academic_year_id, bill_number, bill_date,
      status, subtotal, discount, late_fee, total_amount, paid_amount,
      balance_amount, notes, created_by
    ) values (
      v_student.school_id, v_student_id, v_student.academic_year_id,
      btrim(p_bill_number), p_payment_date, 'unpaid', v_fee, 0, 0, v_fee, 0,
      v_fee, 'Admission fee', auth.uid()
    ) returning id into v_bill_id;

    insert into public.fee_bill_items (
      school_id, bill_id, description, amount, discount, net_amount
    ) values (
      v_student.school_id, v_bill_id, 'Admission Fee', v_fee, 0, v_fee
    ) returning id into v_item_id;

    v_payment := public.record_fee_payment_collection(
      v_student_id, v_bill_id, v_fee, p_payment_mode, p_account_id,
      btrim(p_receipt_number), p_payment_date, null, null,
      jsonb_build_array(jsonb_build_object('fee_bill_item_id', v_item_id, 'amount', v_fee))
    );
    if v_payment->>'success' is distinct from 'true'
      or nullif(v_payment->>'payment_id', '') is null then
      raise exception 'Admission payment could not be recorded.';
    end if;

    update public.fee_payments
       set manual_bill_number = btrim(p_bill_number)
     where id = (v_payment->>'payment_id')::uuid and school_id = v_student.school_id;
    if not found then
      raise exception 'Admission payment bill number could not be saved.';
    end if;
  end if;

  return jsonb_build_object('student_id', v_student_id, 'bill_id', v_bill_id,
    'payment_id', v_payment->>'payment_id');
end;
$function$;

revoke all on function public.create_student_admission(jsonb, numeric, text, text, text, uuid, date) from public, anon;
grant execute on function public.create_student_admission(jsonb, numeric, text, text, text, uuid, date) to authenticated;
notify pgrst, 'reload schema';
