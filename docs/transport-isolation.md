# Transport identity isolation

Drivers and parents must never be added to `school_users`: existing school
membership policies can expose financial and other school data. Provision
transport-only accounts in `transport_users` through the service role instead.
Review existing memberships before enabling these roles; this migration does
not move or remove any existing `school_users` rows.

Authenticated users can read only their own transport memberships. Only the
service role can write them. The membership SELECT policy intentionally does
not call `school_has_module`: that function checks `school_users` and would
exclude transport-only accounts. Portal server guards instead verify the
authenticated user's active transport membership before reading that
membership's school status and enabled modules with the service role.

An account that also has a `school_users` membership retains that membership's
existing database access. Portal routing and guards do not replace RLS: future
transport tables and data entry points must enforce their own authorization.
