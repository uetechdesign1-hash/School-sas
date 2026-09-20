/*
 * WARNING: Permanently deletes school and ALL its data.
 * Cannot be undone without backup.
 * School UUID: a2384731-27e7-448b-9125-45f4181b1651
 * 
 * Run in Supabase SQL Editor
 */

DO $$
DECLARE
    v_school_id uuid := 'a2384731-27e7-448b-9125-45f4181b1651';
BEGIN
    -- Helper: Use PERFORM with exception handling to safely delete
    -- Tables that should exist (core data)
    
    DELETE FROM public.accounting_audit_log WHERE school_id = v_school_id;
    DELETE FROM public.accounting_events WHERE school_id = v_school_id;
    DELETE FROM public.opening_balances WHERE school_id = v_school_id;
    DELETE FROM public.journal_lines WHERE school_id = v_school_id;
    DELETE FROM public.journal_entries WHERE school_id = v_school_id;
    DELETE FROM public.fiscal_years WHERE school_id = v_school_id;
    DELETE FROM public.accounts WHERE school_id = v_school_id;
    
    DELETE FROM public.fee_payment_allocations WHERE school_id = v_school_id;
    DELETE FROM public.fee_payments WHERE school_id = v_school_id;
    DELETE FROM public.fee_bill_items WHERE school_id = v_school_id;
    DELETE FROM public.fee_bills WHERE school_id = v_school_id;
    DELETE FROM public.fee_categories WHERE school_id = v_school_id;
    
    DELETE FROM public.students WHERE school_id = v_school_id;
    DELETE FROM public.staff WHERE school_id = v_school_id;
    
    DELETE FROM public.sections WHERE school_id = v_school_id;
    DELETE FROM public.classes WHERE school_id = v_school_id;
    DELETE FROM public.academic_years WHERE school_id = v_school_id;
    
    -- Optional tables - skip if not exist
    -- These are wrapped individually to handle missing tables
    
    BEGIN DELETE FROM public.transport_routes WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.transport_fees WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.library_transactions WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.library_books WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.attendance WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.teacher_attendance WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.expenses WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.expense_categories WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.payroll_items WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.payroll_runs WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.salary_slips WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.leave_requests WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.vendor_payments WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.vendor_purchases WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.vendors WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.inventory_transactions WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.inventory_items WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.purchase_returns WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.purchase_orders WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    -- Delete from underlying transaction tables instead
    BEGIN DELETE FROM public.transactions WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.documents WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.messages_read WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.messages WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.notice_read WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.notice WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    BEGIN DELETE FROM public.exam_results WHERE school_id = v_school_id; EXCEPTION WHEN undefined_table THEN END;
    
    -- Finally delete the school
    DELETE FROM public.schools WHERE id = v_school_id;
    
    RAISE NOTICE 'School a2384731-27e7-448b-9125-45f4181b1651 deleted.';
END $$;
