This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Offline Staff Attendance

To enable offline GPS check-in/out:

1. Apply `supabase/migrations/20260930130000_offline_staff_attendance.sql` to the Supabase project.
2. Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable. Do not expose it with a `NEXT_PUBLIC_` prefix.
3. Choose **Offline — save GPS locally and sync later** in Add Staff (or the staff edit page).
4. Have the staff member sign in, open **My Attendance**, and open the offline attendance screen once while connected. Allow location access; the browser caches the screen for later use.
5. If the connection drops, open the cached offline attendance screen and record check-in/out. Reconnect and open the regular attendance page before the end of that school day to sync.

Offline records are pending until the server accepts them. Sync rechecks the configured school geofence and school-day deadline; rejected events are shown and are not reported as official attendance. GPS and device time are collected by the browser and are not cryptographic proof of physical presence. Service workers and browser geolocation require HTTPS, except on localhost.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
