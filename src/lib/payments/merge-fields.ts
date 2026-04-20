import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMergeFieldValues,
  buildMergeFieldValues,
} from "@/lib/contracts/merge-fields";
import { PAYMENT_EMAIL_EXTRA_MERGE_FIELDS } from "./types";
import type { PaymentEmailMergeExtras } from "./types";

// Categorization mirrors MERGE_FIELD_CATEGORIES but local so the contract
// type union isn't widened. The /settings/payments sidebar renders these
// under the shared Customer/Job/Company/Insurance groups plus these two.
export const PAYMENT_MERGE_FIELD_CATEGORIES = ["Payment", "Invoice"] as const;
export type PaymentMergeFieldCategory =
  (typeof PAYMENT_MERGE_FIELD_CATEGORIES)[number];

export interface PaymentMergeFieldDefinition {
  name: string;
  label: string;
  category: PaymentMergeFieldCategory;
}

const PAYMENT_ONLY: PaymentMergeFieldDefinition[] = [
  { name: "request_title", label: "Request Title", category: "Payment" },
  { name: "amount", label: "Amount (raw)", category: "Payment" },
  { name: "amount_formatted", label: "Amount", category: "Payment" },
  { name: "card_fee_amount", label: "Card Fee (raw)", category: "Payment" },
  { name: "card_fee_formatted", label: "Card Fee", category: "Payment" },
  { name: "total_with_fee_formatted", label: "Amount + Card Fee", category: "Payment" },
  { name: "payment_link", label: "Payment Link", category: "Payment" },
  { name: "link_expires_at", label: "Link Expiration Date", category: "Payment" },
  { name: "link_expires_in_days", label: "Link Expires In (days)", category: "Payment" },
];

const INVOICE_ONLY: PaymentMergeFieldDefinition[] = [
  { name: "invoice_number", label: "Invoice Number", category: "Invoice" },
  { name: "invoice_total_formatted", label: "Invoice Total", category: "Invoice" },
  { name: "invoice_balance_formatted", label: "Invoice Balance", category: "Invoice" },
];

export const PAYMENT_MERGE_FIELDS: PaymentMergeFieldDefinition[] = [
  ...PAYMENT_ONLY,
  ...INVOICE_ONLY,
];

export function paymentMergeFieldsByCategory(): Record<
  PaymentMergeFieldCategory,
  PaymentMergeFieldDefinition[]
> {
  const grouped: Record<PaymentMergeFieldCategory, PaymentMergeFieldDefinition[]> = {
    Payment: [],
    Invoice: [],
  };
  for (const f of PAYMENT_MERGE_FIELDS) grouped[f.category].push(f);
  return grouped;
}

// USD formatter. Single source of truth so emails and the /pay page show
// the same strings.
export function formatUsd(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

interface PaymentRequestLite {
  id: string;
  job_id: string;
  invoice_id: string | null;
  title: string;
  amount: number;
  card_fee_amount: number | null;
  link_token: string | null;
  link_expires_at: string | null;
}

interface StripeConnectionFees {
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  total_amount: number;
}

// Builds the full merge-field value map for a given payment request. It
// delegates customer/job/company/insurance fields to the shared contract
// resolver (so contract_phone, customer_address, etc. all resolve the
// same way) and layers payment + invoice fields on top.
export async function buildPaymentMergeFieldValues(
  supabase: SupabaseClient,
  pr: PaymentRequestLite,
  opts?: { appUrl?: string; stripeConnection?: StripeConnectionFees | null },
): Promise<Record<string, string | null>> {
  const values = await buildMergeFieldValues(supabase, pr.job_id);

  const appUrl =
    opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Card fee formatting. Prefer the stored card_fee_amount (set at
  // /api/pay/[token]/checkout time when the customer chooses the card
  // path). Otherwise compute from the connection's pass_card_fee +
  // card_fee_percent for the email-template preview case.
  let cardFee = pr.card_fee_amount;
  if (cardFee == null && opts?.stripeConnection?.pass_card_fee_to_customer) {
    cardFee = Math.round(
      pr.amount * (Number(opts.stripeConnection.card_fee_percent) / 100) * 100,
    ) / 100;
  }
  const totalWithFee = cardFee != null ? pr.amount + cardFee : null;

  // Link expiry
  let linkExpiresIso: string | null = pr.link_expires_at;
  let linkExpiresInDays: string | null = null;
  if (linkExpiresIso) {
    try {
      linkExpiresInDays = String(
        daysBetween(new Date(), new Date(linkExpiresIso)),
      );
    } catch {
      linkExpiresInDays = null;
    }
  }

  values.request_title = pr.title;
  values.amount = String(pr.amount.toFixed(2));
  values.amount_formatted = formatUsd(pr.amount);
  values.card_fee_amount = cardFee != null ? String(cardFee.toFixed(2)) : null;
  values.card_fee_formatted = formatUsd(cardFee);
  values.total_with_fee_formatted = formatUsd(totalWithFee);
  values.payment_link = pr.link_token ? `${appUrl}/pay/${pr.link_token}` : null;
  values.link_expires_at = formatDate(linkExpiresIso);
  values.link_expires_in_days = linkExpiresInDays;

  // Invoice fields
  if (pr.invoice_id) {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<InvoiceRow>();
    if (invoice) {
      values.invoice_number = invoice.invoice_number;
      values.invoice_total_formatted = formatUsd(Number(invoice.total_amount));
      // Compute balance: total_amount - sum(payments where status='received')
      const { data: payments } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", pr.invoice_id);
      const paid = (payments ?? [])
        .filter(
          (p: { amount: number; status: string }) => p.status === "received",
        )
        .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
      const balance = Number(invoice.total_amount) - paid;
      values.invoice_balance_formatted = formatUsd(balance);
    }
  }

  return values;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Resolves a payment email subject + body against a payment request.
// Parallels resolveEmailTemplate from src/lib/contracts/email-merge-fields.ts.
export async function resolvePaymentEmailTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  pr: PaymentRequestLite,
  opts?: {
    appUrl?: string;
    stripeConnection?: StripeConnectionFees | null;
  },
): Promise<{ subject: string; html: string; unresolvedFields: string[] }> {
  const values = await buildPaymentMergeFieldValues(supabase, pr, opts);

  const subjResult = applyMergeFieldValues(subjectTemplate, values);
  const subject = decodeHtmlEntities(subjResult.html);

  const bodyResult = applyMergeFieldValues(bodyTemplate, values);

  const unresolved = Array.from(
    new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]),
  );
  return { subject, html: bodyResult.html, unresolvedFields: unresolved };
}

// Export for the settings sidebar.
export { PAYMENT_EMAIL_EXTRA_MERGE_FIELDS };

// Suppress unused-import warning for PaymentEmailMergeExtras (kept for
// future re-exports).
export type { PaymentEmailMergeExtras };
