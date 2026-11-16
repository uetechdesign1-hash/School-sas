# Account email management

The migration `20261115190500_email_change_workflow.sql` adds the email sync
triggers and `staff_email_status` view. Apply it before deploying the matching
application changes.

## Email changes

The app changes login emails immediately through Supabase Auth's server-side
Admin API. Requests are authorized by account role: principals can change
their own email and their school's staff email; Super Admins can change a
school principal's email. The new email is marked confirmed, so no confirmation
email is sent. Staff without a linked login have only their contact email
updated.

The app does not write directly to `auth.users`; it uses the Supabase Auth
Admin API and requires `SUPABASE_SERVICE_ROLE_KEY` to be configured on the
server. Since this bypasses proof of control of the new address, restrict these
actions to trusted principals and Super Admins. The database trigger syncs
confirmed Auth emails to `user_profiles.email` and linked `staff.email`.

Password recovery still uses Supabase Auth and requires working SMTP and the
Auth redirect allow-list to include `/auth/update-password`. The verified
phone-and-school-code recovery path looks up the linked Auth email before
sending a reset email.

## Check staff email synchronization

```sql
SELECT *
FROM public.staff_email_status
WHERE staff_id = 'staff-record-uuid';
```

`SYNCED` means the staff and profile emails match; `MISMATCH` means they do
not; `NO_EMAIL` means one or both records have no email.
