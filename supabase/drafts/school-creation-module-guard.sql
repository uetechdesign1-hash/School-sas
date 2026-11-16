-- SUPERSEDED: do not apply this draft.
-- The approved, consolidated migration is
-- ../migrations/20261115210000_retire_transport_plan_entitlement.sql.
-- This guard prevents the obsolete Super-Admin-only policy from being applied.
DO $$
BEGIN
  RAISE EXCEPTION
    'This draft is superseded; review the approved school-creation policy migration instead.';
END;
$$;
