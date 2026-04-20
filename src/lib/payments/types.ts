export type PaymentEmailProvider = "resend" | "email_account";

export interface PaymentEmailSettings {
  id: string;
  send_from_email: string;
  send_from_name: string;
  reply_to_email: string | null;
  provider: PaymentEmailProvider;
  email_account_id: string | null;
  payment_request_subject_template: string;
  payment_request_body_template: string;
  payment_reminder_subject_template: string;
  payment_reminder_body_template: string;
  reminder_day_offsets: number[];
  default_link_expiry_days: number;
  fee_disclosure_text: string | null;
  updated_at: string;
}

// Extras the payment merge-field resolver layers on top of the shared
// customer/job/company resolver — matches the /lib/contracts/email-merge-fields
// EMAIL_EXTRA_MERGE_FIELDS shape.
export const PAYMENT_EMAIL_EXTRA_MERGE_FIELDS = [
  { name: "payment_link", label: "Payment Link" },
  { name: "request_title", label: "Request Title" },
  { name: "amount", label: "Amount (raw)" },
  { name: "amount_formatted", label: "Amount (formatted $)" },
  { name: "card_fee_amount", label: "Card Fee (raw)" },
  { name: "card_fee_formatted", label: "Card Fee (formatted $)" },
  { name: "total_with_fee_formatted", label: "Amount + Card Fee (formatted $)" },
  { name: "link_expires_at", label: "Link Expiration Date" },
  { name: "link_expires_in_days", label: "Link Expires In (days)" },
  { name: "invoice_number", label: "Invoice Number" },
  { name: "invoice_total_formatted", label: "Invoice Total (formatted $)" },
  { name: "invoice_balance_formatted", label: "Invoice Balance (formatted $)" },
] as const;

export type PaymentExtraFieldName =
  typeof PAYMENT_EMAIL_EXTRA_MERGE_FIELDS[number]["name"];

// Shape passed into resolvePaymentEmailTemplate.
export interface PaymentEmailMergeExtras {
  payment_link: string;
  request_title: string;
  amount: string;
  amount_formatted: string;
  card_fee_amount: string | null;
  card_fee_formatted: string | null;
  total_with_fee_formatted: string | null;
  link_expires_at: string | null;
  link_expires_in_days: string | null;
  invoice_number: string | null;
  invoice_total_formatted: string | null;
  invoice_balance_formatted: string | null;
}

export interface PaymentRequestRow {
  id: string;
  job_id: string;
  invoice_id: string | null;
  request_type: "invoice" | "deposit" | "retainer" | "partial";
  title: string;
  amount: number;
  card_fee_amount: number | null;
  total_charged: number | null;
  status:
    | "draft" | "sent" | "viewed" | "paid" | "failed"
    | "refunded" | "partially_refunded" | "expired" | "voided";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
  link_token: string | null;
  link_expires_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  reminder_count: number;
  next_reminder_at: string | null;
  voided_at: string | null;
  payer_email: string | null;
  payer_name: string | null;
  created_at: string;
  updated_at: string;
}
