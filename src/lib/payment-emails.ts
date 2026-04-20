import { createServiceClient } from "@/lib/supabase-api";
import { resolvePaymentEmailTemplate } from "@/lib/payments/merge-fields";
import { sendPaymentEmail } from "@/lib/payments/email";
import { writePaymentEvent } from "@/lib/payments/activity";
import type {
  PaymentEmailSettings,
  PaymentRequestRow,
} from "@/lib/payments/types";

interface StripeConnectionFees {
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
}

// Computes the first reminder timestamp given send-time + offsets.
// Mirrors src/lib/contracts/reminders.ts#computeInitialNextReminderAt so
// future cron code can share the same signal.
export function computeInitialNextReminderAt(
  sentAt: Date,
  offsets: number[],
): Date | null {
  const valid = (offsets ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  const first = Math.min(...valid);
  return new Date(sentAt.getTime() + first * 24 * 60 * 60 * 1000);
}

async function loadSettings(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<PaymentEmailSettings> {
  const { data, error } = await supabase
    .from("payment_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<PaymentEmailSettings>();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "payment_email_settings row missing — did the build40 migration run?",
    );
  if (!data.send_from_email || !data.send_from_name) {
    throw new Error(
      "Set a send-from email and display name in Settings → Payment Emails before sending.",
    );
  }
  return data;
}

async function loadPaymentRequest(
  supabase: ReturnType<typeof createServiceClient>,
  paymentRequestId: string,
): Promise<PaymentRequestRow> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`payment_request ${paymentRequestId} not found`);
  return data;
}

async function loadRecipient(
  supabase: ReturnType<typeof createServiceClient>,
  pr: PaymentRequestRow,
): Promise<{ email: string; name: string | null }> {
  if (pr.payer_email) {
    return { email: pr.payer_email, name: pr.payer_name };
  }
  const { data: job } = await supabase
    .from("jobs")
    .select("contact_id")
    .eq("id", pr.job_id)
    .maybeSingle<{ contact_id: string | null }>();
  if (!job?.contact_id) {
    throw new Error(
      "No customer email on file — set a contact email on the job before sending.",
    );
  }
  const { data: contact } = await supabase
    .from("contacts")
    .select("email, first_name, last_name")
    .eq("id", job.contact_id)
    .maybeSingle<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }>();
  if (!contact?.email) {
    throw new Error(
      "Customer contact has no email address — cannot send payment request.",
    );
  }
  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
    null;
  return { email: contact.email, name };
}

async function loadStripeFees(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<StripeConnectionFees | null> {
  const { data } = await supabase
    .from("stripe_connection")
    .select("pass_card_fee_to_customer, card_fee_percent")
    .limit(1)
    .maybeSingle<StripeConnectionFees>();
  return data ?? null;
}

export async function sendPaymentRequestEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_request_subject_template,
    settings.payment_request_body_template,
    pr,
    { stripeConnection: fees },
  );

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });

  // Status + timestamp transition. On first send only.
  const firstReminder = computeInitialNextReminderAt(
    new Date(),
    settings.reminder_day_offsets,
  );
  const { error: upErr } = await supabase
    .from("payment_requests")
    .update({
      status: pr.status === "draft" ? "sent" : pr.status,
      sent_at: pr.sent_at ?? new Date().toISOString(),
      next_reminder_at: firstReminder
        ? firstReminder.toISOString()
        : pr.next_reminder_at,
      payer_email: pr.payer_email ?? recipient.email,
      payer_name: pr.payer_name ?? recipient.name,
    })
    .eq("id", pr.id);
  if (upErr) {
    // Email already went out — surface but keep the DB state best-effort.
    throw new Error(
      `Email sent (message ${sent.messageId}) but status update failed: ${upErr.message}`,
    );
  }

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });

  return sent;
}

export async function sendPaymentReminderEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  if (pr.status !== "sent" && pr.status !== "viewed") {
    throw new Error(
      `Cannot send reminder: payment_request status is ${pr.status}`,
    );
  }
  const recipient = await loadRecipient(supabase, pr);
  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_reminder_subject_template,
    settings.payment_reminder_body_template,
    pr,
    { stripeConnection: fees },
  );
  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });
  await supabase
    .from("payment_requests")
    .update({
      reminder_count: pr.reminder_count + 1,
    })
    .eq("id", pr.id);
  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "reminder_sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });
  return sent;
}
