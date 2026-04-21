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

const PAYMENT_EXTENDED: PaymentMergeFieldDefinition[] = [
  { name: "paid_at", label: "Paid At (raw)", category: "Payment" },
  { name: "paid_at_formatted", label: "Paid At", category: "Payment" },
  { name: "payer_name", label: "Payer Name", category: "Payment" },
  { name: "payer_email", label: "Payer Email", category: "Payment" },
  { name: "payment_method_display", label: "Payment Method", category: "Payment" },
  { name: "transaction_id", label: "Transaction ID", category: "Payment" },
  { name: "stripe_receipt_url", label: "Stripe Receipt URL", category: "Payment" },
  { name: "stripe_fee_formatted", label: "Stripe Fee", category: "Payment" },
  { name: "net_amount_formatted", label: "Net to Bank", category: "Payment" },
  { name: "failure_reason", label: "Failure Reason", category: "Payment" },
  { name: "refund_amount_formatted", label: "Refund Amount", category: "Payment" },
  { name: "refund_reason", label: "Refund Reason", category: "Payment" },
  { name: "refunded_at_formatted", label: "Refund Date", category: "Payment" },
  { name: "refunded_by_name", label: "Refunded By", category: "Payment" },
  { name: "job_link", label: "Job Link (internal)", category: "Payment" },
];

const INVOICE_ONLY: PaymentMergeFieldDefinition[] = [
  { name: "invoice_number", label: "Invoice Number", category: "Invoice" },
  { name: "invoice_total_formatted", label: "Invoice Total", category: "Invoice" },
  { name: "invoice_balance_formatted", label: "Invoice Balance", category: "Invoice" },
];

export const PAYMENT_MERGE_FIELDS: PaymentMergeFieldDefinition[] = [
  ...PAYMENT_ONLY,
  ...PAYMENT_EXTENDED,
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

// Runtime-only merge-field inputs — populated by the webhook handler or
// refund flow from a Stripe event payload. None of these are stored on
// payment_requests directly.
export interface PaymentMergeExtras {
  paid_at?: string | null;
  payer_name?: string | null;
  payer_email?: string | null;
  payment_method_type?: "card" | "us_bank_account" | null;
  card_last4?: string | null;
  card_brand?: string | null;
  bank_name?: string | null;
  transaction_id?: string | null;
  stripe_receipt_url?: string | null;
  stripe_fee_amount?: number | null;
  net_amount?: number | null;
  failure_reason?: string | null;
  refund_amount?: number | null;
  refund_reason?: string | null;
  refunded_at?: string | null;
  refunded_by_name?: string | null;
  job_link?: string | null;
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
  opts?: {
    appUrl?: string;
    stripeConnection?: StripeConnectionFees | null;
    extras?: PaymentMergeExtras;
  },
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

  const extras = opts?.extras ?? {};

  values.paid_at = extras.paid_at ?? null;
  values.paid_at_formatted = formatDate(extras.paid_at ?? null);
  values.payer_name = extras.payer_name ?? null;
  values.payer_email = extras.payer_email ?? null;

  values.payment_method_display = (() => {
    if (extras.payment_method_type === "us_bank_account") {
      return extras.bank_name
        ? `Bank transfer (${extras.bank_name})`
        : "Bank transfer (ACH)";
    }
    if (extras.payment_method_type === "card") {
      const brand = extras.card_brand
        ? extras.card_brand
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        : "Card";
      return extras.card_last4 ? `${brand} ending in ${extras.card_last4}` : brand;
    }
    return null;
  })();

  values.transaction_id = extras.transaction_id
    ? extras.transaction_id.length > 12
      ? `…${extras.transaction_id.slice(-12)}`
      : extras.transaction_id
    : null;
  values.stripe_receipt_url = extras.stripe_receipt_url ?? null;
  values.stripe_fee_formatted = formatUsd(extras.stripe_fee_amount ?? null);
  values.net_amount_formatted = formatUsd(extras.net_amount ?? null);

  values.failure_reason = extras.failure_reason ?? null;

  values.refund_amount_formatted = formatUsd(extras.refund_amount ?? null);
  values.refund_reason = extras.refund_reason ?? null;
  values.refunded_at_formatted = formatDate(extras.refunded_at ?? null);
  values.refunded_by_name = extras.refunded_by_name ?? null;

  values.job_link = extras.job_link ?? null;

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
    extras?: PaymentMergeExtras;
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
