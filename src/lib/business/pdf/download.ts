import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPdfAssets } from "@/lib/business/pdf/assets";
import type { Invoice, InvoiceBalance, SchoolMou, SchoolPayment } from "@/lib/business/types";

// jsPDF is loaded on demand so it never weighs down the dashboards.

export async function downloadMouPdf(supabase: SupabaseClient, mou: SchoolMou) {
  const [{ createMouPdf }, assets] = await Promise.all([
    import("@/lib/business/pdf/documents"),
    loadPdfAssets(supabase, mou.snapshot.company),
  ]);
  createMouPdf(mou.snapshot, assets).save(`${mou.mou_number}.pdf`);
}

export async function downloadInvoicePdf(
  supabase: SupabaseClient,
  invoice: Invoice,
  balance: Pick<InvoiceBalance, "paid_amount" | "balance_amount" | "display_status">,
) {
  const [{ createInvoicePdf }, assets] = await Promise.all([
    import("@/lib/business/pdf/documents"),
    loadPdfAssets(supabase, invoice.snapshot.company),
  ]);
  createInvoicePdf(invoice, balance, assets).save(`${invoice.invoice_number}.pdf`);
}

export async function downloadReceiptPdf(supabase: SupabaseClient, payment: SchoolPayment) {
  if (!payment.receipt_snapshot) {
    throw new Error("A receipt is available only after the payment is verified.");
  }
  const [{ createReceiptPdf }, assets] = await Promise.all([
    import("@/lib/business/pdf/documents"),
    loadPdfAssets(supabase, payment.receipt_snapshot.company),
  ]);
  createReceiptPdf(payment.receipt_snapshot, assets).save(`${payment.receipt_snapshot.receipt_number}.pdf`);
}
