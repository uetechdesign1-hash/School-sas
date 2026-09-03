import type { Metadata } from "next";
import "./globals.css";
import SchoolAccessGuard from "@/components/auth/SchoolAccessGuard";

export const metadata: Metadata = {
  title: "SchoolFlow",
  description: "Simple school management software for growing schools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><SchoolAccessGuard>{children}</SchoolAccessGuard></body>
    </html>
  );
}
