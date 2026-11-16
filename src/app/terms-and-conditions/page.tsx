import type { Metadata } from "next";
import { PublicPolicyPage } from "@/components/business/public-policy";

export const revalidate = 300;
export const metadata: Metadata = { title: "Terms & Conditions" };

export default function TermsAndConditionsPage() {
  return <PublicPolicyPage type="terms_and_conditions" fallbackTitle="Terms & Conditions" />;
}
