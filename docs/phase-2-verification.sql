-- Phase 2 verification (read-only). Run after the Phase 2 script. Every block
-- returns rows to inspect; blocks named "EXPECT 0 ROWS" must return nothing.

-- 1. Phase 2 tables, RLS status, and privileges held by anon/authenticated
WITH t(name) AS (VALUES
  ('business_audit_logs'), ('business_number_sequences'), ('company_settings'),
  ('website_policies'), ('mou_terms_versions'), ('subscription_plans'),
  ('subscription_plan_prices'), ('sales_representatives'),
  ('business_provisioning_jobs'), ('school_sales_ownership'),
  ('school_sales_assignments'), ('school_leads'), ('sales_activity_logs'),
  ('school_subscription_history'), ('billing_count_confirmations'),
  ('school_mous'), ('school_invoices'), ('school_payments'),
  ('payment_verification_logs'), ('payment_reversals'))
SELECT t.name AS table_name,
       c.oid IS NOT NULL AS exists,
       COALESCE(c.relrowsecurity, false) AS rls_enabled,
       (SELECT string_agg(DISTINCT g.grantee || ':' || g.privilege_type, ', ' ORDER BY g.grantee || ':' || g.privilege_type)
        FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = t.name
          AND g.grantee IN ('anon', 'authenticated')) AS api_privileges
FROM t
LEFT JOIN pg_class c ON c.relname = t.name AND c.relnamespace = 'public'::regnamespace
ORDER BY t.name;

-- 2. EXPECT 0 ROWS: any Phase 2 table without RLS, or any anon write privilege
SELECT c.relname AS table_name, 'RLS disabled' AS problem
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND c.relname IN ('business_audit_logs', 'business_number_sequences', 'company_settings',
    'website_policies', 'mou_terms_versions', 'subscription_plans', 'subscription_plan_prices',
    'sales_representatives', 'business_provisioning_jobs', 'school_sales_ownership',
    'school_sales_assignments', 'school_leads', 'sales_activity_logs',
    'school_subscription_history', 'billing_count_confirmations', 'school_mous',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals')
  AND NOT c.relrowsecurity
UNION ALL
SELECT g.table_name::text, 'anon holds ' || g.privilege_type
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public' AND g.grantee = 'anon'
  AND g.table_name IN ('business_audit_logs', 'business_number_sequences', 'company_settings',
    'mou_terms_versions', 'subscription_plans', 'subscription_plan_prices',
    'sales_representatives', 'business_provisioning_jobs', 'school_sales_ownership',
    'school_sales_assignments', 'school_leads', 'sales_activity_logs',
    'school_subscription_history', 'billing_count_confirmations', 'school_mous',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals')
UNION ALL
SELECT g.table_name::text, 'anon holds ' || g.privilege_type
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public' AND g.grantee = 'anon' AND g.table_name = 'website_policies'
  AND g.privilege_type <> 'SELECT'
UNION ALL
SELECT g.table_name::text, 'authenticated holds ' || g.privilege_type
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public' AND g.grantee = 'authenticated'
  AND g.table_name IN ('business_audit_logs', 'business_number_sequences',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals',
    'school_mous', 'school_subscription_history', 'billing_count_confirmations',
    'school_sales_ownership', 'school_sales_assignments', 'business_provisioning_jobs')
  AND g.privilege_type <> 'SELECT';

-- 3. Columns added to existing tables
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'schools' AND column_name IN (
        'subscription_amount', 'subscription_payment_terms', 'sales_discussion_confirmed',
        'sales_discussion_confirmed_at', 'sales_discussion_confirmed_by', 'district',
        'principal_name', 'contact_person', 'branch_count', 'staff_strength',
        'is_platform_internal'))
    OR (table_name = 'school_subscriptions' AND column_name IN (
        'payment_terms', 'subscription_plan_id', 'enabled_modules', 'pricing_unit',
        'estimated_student_count', 'billing_student_count', 'default_unit_price',
        'negotiated_unit_price', 'discount_amount', 'contract_term_months',
        'billing_frequency', 'monthly_instalments_allowed', 'special_conditions',
        'price_outside_recommended_range', 'pricing_snapshot', 'agreement_version', 'amount')))
ORDER BY table_name, column_name;

-- 4. EXPECT 0 ROWS: money columns that are not numeric(18,2)
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name IN ('school_invoices', 'school_payments', 'payment_reversals',
          'billing_count_confirmations', 'school_mous', 'subscription_plan_prices',
          'school_subscription_history')
        AND (column_name LIKE '%amount%' OR column_name LIKE '%price%')
        AND data_type = 'numeric')
    OR (table_name = 'school_subscriptions'
        AND column_name IN ('amount', 'default_unit_price', 'negotiated_unit_price', 'discount_amount')
        AND data_type = 'numeric')
    OR (table_name = 'schools' AND column_name = 'subscription_amount'))
  AND NOT (numeric_precision = 18 AND numeric_scale = 2)
  AND column_name <> 'tax_rate';

-- 5. Constraints and indexes on the Phase 2 tables
SELECT conrelid::regclass::text AS table_name, conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
    'company_settings', 'website_policies', 'mou_terms_versions', 'subscription_plans',
    'subscription_plan_prices', 'sales_representatives', 'business_provisioning_jobs',
    'school_sales_ownership', 'school_sales_assignments', 'school_leads', 'sales_activity_logs',
    'school_subscription_history', 'billing_count_confirmations', 'school_mous',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals',
    'school_subscriptions')
ORDER BY 1, 2;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (tablename IN (
    'company_settings', 'website_policies', 'mou_terms_versions', 'subscription_plans',
    'subscription_plan_prices', 'sales_representatives', 'business_provisioning_jobs',
    'school_sales_ownership', 'school_sales_assignments', 'school_leads', 'sales_activity_logs',
    'school_subscription_history', 'billing_count_confirmations', 'school_mous',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals',
    'business_audit_logs') OR indexname LIKE 'school_subscriptions_one_active%')
ORDER BY tablename, indexname;

-- 6. Functions and who may execute them
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'business\_%' OR p.proname IN (
    'publish_website_policy', 'publish_mou_terms', 'set_subscription_plan_price',
    'quote_subscription', 'start_sales_rep_provisioning', 'start_school_owner_provisioning',
    'claim_provisioning_job', 'record_provisioned_auth_user', 'complete_provisioning_job',
    'fail_provisioning_job', 'reset_provisioning_job', 'cancel_provisioning_job',
    'list_orphan_auth_accounts', 'set_sales_rep_active', 'reassign_school_rep', 'reassign_lead',
    'generate_school_invoices', 'generate_due_invoices', 'cancel_school_invoice',
    'create_school_sale', 'generate_initial_mou', 'request_billing_count_confirmation',
    'decide_billing_count_confirmation', 'submit_school_payment', 'verify_school_payment',
    'reject_school_payment', 'refund_school_payment', 'next_business_number',
    'is_active_sales_rep', 'rep_owns_school', 'is_platform_internal_school',
    'is_school_creator', 'guard_user_profile_privileges', 'protect_platform_internal_school'))
ORDER BY p.proname;

-- 7. EXPECT 0 ROWS: Phase 2 functions callable by anon
SELECT p.proname
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'business\_%' OR p.proname IN (
    'publish_website_policy', 'publish_mou_terms', 'set_subscription_plan_price',
    'quote_subscription', 'start_sales_rep_provisioning', 'start_school_owner_provisioning',
    'claim_provisioning_job', 'record_provisioned_auth_user', 'complete_provisioning_job',
    'fail_provisioning_job', 'reset_provisioning_job', 'cancel_provisioning_job',
    'list_orphan_auth_accounts', 'set_sales_rep_active', 'reassign_school_rep', 'reassign_lead',
    'generate_school_invoices', 'generate_due_invoices', 'cancel_school_invoice',
    'create_school_sale', 'generate_initial_mou', 'request_billing_count_confirmation',
    'decide_billing_count_confirmation', 'submit_school_payment', 'verify_school_payment',
    'reject_school_payment', 'refund_school_payment', 'next_business_number',
    'is_active_sales_rep', 'rep_owns_school', 'is_school_creator'))
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 8. Triggers
SELECT c.relname AS table_name, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  AND (c.relname IN (
    'company_settings', 'website_policies', 'mou_terms_versions', 'subscription_plans',
    'subscription_plan_prices', 'sales_representatives', 'business_provisioning_jobs',
    'school_sales_ownership', 'school_sales_assignments', 'school_leads', 'sales_activity_logs',
    'school_subscription_history', 'billing_count_confirmations', 'school_mous',
    'school_invoices', 'school_payments', 'payment_verification_logs', 'payment_reversals',
    'business_audit_logs', 'school_subscriptions', 'schools', 'school_users', 'user_profiles'))
ORDER BY c.relname, t.tgname;

-- 9. Row-level security policies on Phase 2 tables and the extended core tables
SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename IN (
    'business_audit_logs', 'company_settings', 'website_policies', 'mou_terms_versions',
    'subscription_plans', 'subscription_plan_prices', 'sales_representatives',
    'business_provisioning_jobs', 'school_sales_ownership', 'school_sales_assignments',
    'school_leads', 'sales_activity_logs', 'school_subscription_history',
    'billing_count_confirmations', 'school_mous', 'school_invoices', 'school_payments',
    'payment_verification_logs', 'payment_reversals')
   OR policyname IN ('schools_sales_rep_select', 'schools_hide_platform_internal',
                     'schools_hide_platform_internal_anon', 'schools_authorized_creator_insert',
                     'school_subscriptions_sales_rep_select'))
ORDER BY tablename, policyname;

-- 10. Storage bucket and policies
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'company-assets';

SELECT policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'company\_assets\_%'
ORDER BY policyname;

-- 11. Seed data and the hidden platform-company tenant
SELECT p.code, p.pricing_unit, pr.default_price, pr.recommended_min_price,
       pr.recommended_max_price, pr.effective_from
FROM public.subscription_plans p
JOIN public.subscription_plan_prices pr ON pr.plan_id = p.id AND pr.effective_to IS NULL
ORDER BY p.sort_order;

SELECT policy_type, version, status, effective_date FROM public.website_policies ORDER BY 1, 2;
SELECT version, status, effective_date FROM public.mou_terms_versions ORDER BY 1;

SELECT s.id, s.code, s.status::text, s.is_platform_internal,
       (SELECT count(*) FROM public.accounts a WHERE a.school_id = s.id) AS accounts,
       (SELECT string_agg(a.code, ', ' ORDER BY a.code) FROM public.accounts a WHERE a.school_id = s.id) AS account_codes,
       (SELECT count(*) FROM public.school_users su WHERE su.school_id = s.id) AS members
FROM public.schools s WHERE s.is_platform_internal;

-- 12. EXPECT 0 ROWS: the platform tenant leaking into business data
SELECT 'school_subscriptions' AS leaked_into, count(*)::int AS rows
FROM public.school_subscriptions x WHERE public.is_platform_internal_school(x.school_id)
HAVING count(*) > 0
UNION ALL
SELECT 'school_sales_ownership', count(*)::int FROM public.school_sales_ownership x
WHERE public.is_platform_internal_school(x.school_id) HAVING count(*) > 0
UNION ALL
SELECT 'school_invoices', count(*)::int FROM public.school_invoices x
WHERE public.is_platform_internal_school(x.school_id) HAVING count(*) > 0;

-- 13. Accounting integration sanity (live accounting_events unique index)
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'accounting_events'
  AND indexdef ILIKE 'CREATE UNIQUE INDEX%(school_id, source_module, source_table, source_record_id)%';

-- 14. Platform role enum
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.platform_role'::regtype ORDER BY enumsortorder;
