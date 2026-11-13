# Module access: database enforcement review

The current page guards and Next.js API checks are not a security boundary for
direct Supabase calls. Authenticated clients can still use existing table
policies and RPC grants. No database policies, functions, or migrations are
changed by this work.

This inventory is based on repository callers and migrations, not inspection of
the live database. Before writing a migration, compare it with the live schema,
policies, grants, triggers, overloads, and all deployed clients. Inventory any
additional objects discovered there; the list below is not a claim that the
live database has no others.

## Fee-specific objects

Review SELECT and write policies, ownership chains, and grants for
`fee_categories`, `fee_structures`, `fee_structure_items`, `fee_bills`,
`fee_bill_items`, `fee_concessions`, `fee_payments`, `fee_payment_allocations`,
`fee_payment_splits`, `fee_carry_forwards`, and the legacy `student_fee_bills`.
Require the `fees` module for fee-specific operations, including access through
child records that may need their school derived from a parent.

Review the definitions, grants, callers, and school derivation of
`add_fee_items_to_bill`, `create_admission_fee_bill`,
`create_fee_carry_forward`, `create_student_fee_bill`,
`delete_fee_concession_and_recalculate`, `delete_fee_payment_receipt`,
`get_receipt_history`, `recalculate_fee_bill`,
`reclassify_inventory_fee_payment`, `record_fee_payment_collection`,
`record_fee_payment_collection_split`, `record_student_fee_payment`,
`remove_fee_items_from_bill`, `update_fee_concession`,
`update_fee_payment_collection`, `update_fee_payment_collection_split`, and
`update_other_fee_item`. Check admission, promotion, inventory and carry-forward
triggers and RPCs for indirect fee writes, including the admission fee
assignment migration. Decide how core student creation and promotion should work
without fees before enforcing those dependencies.

## Payroll and attendance objects

Review `payroll_runs`, `payroll_items`, `staff_salary_structures`,
`staff_attendance`, `staff_attendance_overrides`, `staff_attendance_timings`,
`staff_attendance_settings`, `staff_attendance_offline_syncs`, and
`school_attendance_calendar` / `school_attendance_settings`. Determine which
attendance settings are also used by core student attendance before gating.
Review `get_staff_attendance_settings`, `save_staff_attendance_settings`,
`staff_check_in`, `staff_check_out`, and `sync_staff_offline_attendance`.
The offline sync RPC currently takes a user ID and is called with service-role
privileges: preserve its staff identity checks and explicitly define how
trusted service calls prove the target school's module access.

`staff` and `employees` also support core identity and user management. Review
column-level access and dependent workflows rather than blindly denying the
whole tables to schools without payroll.

## Shared ledger and core data

Do not gate `accounts`, `transactions`, `transaction_entries`,
`journal_entries`, `journal_lines`, `accounting_events`, `expenses`,
`receipts`, or shared RPCs such as `create_journal_entry` and `delete_receipt`
solely on `fees`. Payroll-only schools need the shared ledger. Restrict
fee-specific and payroll-specific entry points and validate the source
operation instead. Likewise, keep `schools`, `school_users`, `profiles`,
`students`, `student_enrollments`, `academic_years`, `classes`, and `sections`
available to their existing core workflows.

For each `SECURITY DEFINER` function, use a fixed `search_path`, verify
`auth.uid()` and the target school, and test grants and service-role behavior.
Review super-admin access, suspended schools, cross-school IDs, child rows,
and races when modules are disabled. Test fee-only, payroll-only,
transport-only, and combined plans, including payroll journal posting and
direct PostgREST/RPC calls.
