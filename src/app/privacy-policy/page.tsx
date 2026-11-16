import type { Metadata } from "next";
import { PublicPolicyPage } from "@/components/business/public-policy";

export const revalidate = 300;
export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPolicyPage() {
  return <PublicPolicyPage type="privacy_policy" fallbackTitle="Privacy Policy" />;
}
