import DevInspector from '@/components/DevInspector';
import type { Metadata } from "next";
import "./globals.css";
import SchoolAccessGuard from "@/components/auth/SchoolAccessGuard";
import OfflineAttendanceServiceWorker from "@/components/staff/OfflineAttendanceServiceWorker";

const siteUrl = "https://scbcloud.in";

export const metadata: Metadata = {
  title: {
    template: "%s | SCB – Smart Campus Board",
    default: "SCB | Smart Campus Board",
  },
  description:
    "Smart Campus Board (SCB) is a complete school management platform for students, staff, attendance, fees, payroll, expenses, accounting and reports. Run your school on the cloud at scbcloud.in.",
  keywords: [
    "scb",
    "smart campus board",
    "scbcloud.in",
    "school management system",
    "school management software",
    "school erp",
    "student management system",
    "staff attendance management",
    "fee management system",
    "payroll software for schools",
    "school accounting software",
    "reports and analytics for schools",
  ],
  authors: [{ name: "Smart Campus Board", url: siteUrl }],
  creator: "Smart Campus Board",
  publisher: "Smart Campus Board",
  robots: "index, follow",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "SCB | Smart Campus Board",
    description:
      "Smart Campus Board (SCB) is a complete school management platform for students, staff, attendance, fees, payroll, expenses, accounting and reports.",
    url: siteUrl,
    siteName: "Smart Campus Board",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SCB | Smart Campus Board",
    description:
      "Smart Campus Board (SCB) is a complete school management platform for schools.",
    site: "@scbcloud",
    creator: "@scbcloud",
  },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Smart Campus Board",
              url: siteUrl,
              contactPoint: {
                "@type": "ContactPoint",
                telephone: "+91-7780670760",
                contactType: "customer service",
                availableLanguage: ["en", "hi"],
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "SCB",
              url: siteUrl,
            }),
          }}
        />
      </body>
    </html>
  );
}
