-- Force every PostgREST instance to reload its schema cache.
-- The vendor-purchases tables existed before the API layer picked them up,
-- leaving some REST instances with a stale cache that returned
-- "table not found in schema cache" (PGRST205). A NOTIFY is broadcast to
-- every listening instance, so this guarantees a global reload.

notify pgrst, 'reload schema';
