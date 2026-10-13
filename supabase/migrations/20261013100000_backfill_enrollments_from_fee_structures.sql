-- Repair for students promoted BEFORE enrollment history existed.
--
-- Their students row already says "Class 2 / 2026-2027", and nothing remembers
-- that their 2025-2026 bill was for Class 1. The 2025-2026 bill was created
-- from the Class 1 fee structure, so the class can be recovered from
-- fee_bill_items.fee_structure_id -> fee_structures.class_id.
--
-- Safe to run more than once.

insert into public.student_enrollments
  (school_id, student_id, academic_year_id, class_id)
select distinct on (b.student_id, b.academic_year_id)
  b.school_id, b.student_id, b.academic_year_id, fs.class_id
from public.fee_bills b
join public.fee_bill_items i on i.bill_id = b.id and i.fee_structure_id is not null
join public.fee_structures fs on fs.id = i.fee_structure_id
where b.academic_year_id is not null
  and fs.class_id is not null
  and b.status <> 'cancelled'
order by b.student_id, b.academic_year_id, b.bill_date
on conflict (student_id, academic_year_id) do nothing;

-- Copy the recovered class onto bills that have no class snapshot yet.
update public.fee_bills b
set class_id = e.class_id,
    section_id = e.section_id
from public.student_enrollments e
where e.student_id = b.student_id
  and e.academic_year_id = b.academic_year_id
  and b.class_id is null;
