import type { Metadata } from "next";
import "./globals.css";
import SchoolAccessGuard from "@/components/auth/SchoolAccessGuard";

export const metadata: Metadata = {
  title: "EduNexa | Complete School Management Platform",
  description:
    "EduNexa is a complete school management platform for students, staff, attendance, fees, payroll, expenses, accounting and reports.",
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
      </body>
    </html>
  );
}