import DevInspector from '@/components/DevInspector';
import type { Metadata } from "next";
import "./globals.css";
import SchoolAccessGuard from "@/components/auth/SchoolAccessGuard";
import OfflineAttendanceServiceWorker from "@/components/staff/OfflineAttendanceServiceWorker";

export const metadata: Metadata = {
  title: "SCB | Smart Campus Board",
  description:
    "Smart Campus Board is a complete school management platform for students, staff, attendance, fees, payroll, expenses, accounting and reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SchoolAccessGuard>{children}</SchoolAccessGuard>
        <OfflineAttendanceServiceWorker />
        <DevInspector />
      </body>
    </html>
  );
}
