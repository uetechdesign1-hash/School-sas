export type Money = number | string | null | undefined;

export function toNumber(value: Money): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Screen currency, e.g. ₹18,000.00 */
export function formatInr(value: Money): string {
  return inr.format(toNumber(value));
}

/** PDF currency. The built-in PDF fonts cannot draw the rupee glyph. */
export function formatPdfInr(value: Money): string {
  return `Rs. ${plain.format(toNumber(value))}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatMonth(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(parsed);
}

export function titleCase(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const LEAD_STATUSES = [
  { value: "new_lead", label: "New Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "meeting_scheduled", label: "Meeting Scheduled" },
  { value: "negotiation", label: "Negotiation" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "initial_mou", label: "Initial MOU" },
  { value: "converted", label: "Converted" },
  { value: "not_interested", label: "Not Interested" },
] as const;

export const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
] as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending_verification: "Pending Verification",
  verified: "Verified",
  rejected: "Rejected",
  reversed: "Reversed",
  refunded: "Refunded",
};

export type Tone = "slate" | "green" | "amber" | "red" | "blue" | "purple";

export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "verified":
    case "active":
    case "paid":
    case "approved":
    case "converted":
    case "completed":
    case "published":
      return "green";
    case "pending_verification":
    case "pending_approval":
    case "partially_paid":
    case "unpaid":
    case "pending":
    case "pending_account":
    case "draft":
    case "auth_created":
      return "amber";
    case "rejected":
    case "reversed":
    case "refunded":
    case "overdue":
    case "failed":
    case "inactive":
    case "cancelled":
    case "not_interested":
      return "red";
    case "archived":
      return "slate";
    default:
      return "blue";
  }
}

export function planLabel(code: string | null | undefined): string {
  switch (code) {
    case "plan1":
      return "Plan 1";
    case "plan2":
      return "Plan 2";
    case "both":
      return "Both Plans";
    default:
      return titleCase(code);
  }
}

export function pricingUnitLabel(unit: string | null | undefined): string {
  return unit === "per_school_year" ? "per school / year" : "per student / year";
}
