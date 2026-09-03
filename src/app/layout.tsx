import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}