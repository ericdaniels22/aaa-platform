import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import type { ContractEmailSettings } from "./types";

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendResult {
  messageId: string;
  provider: "resend" | "smtp";
}

function requireResendKey(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new Error("RESEND_API_KEY is not set");
  return k;
}

function formatFromHeader(name: string, address: string): string {
  // Quote the display name so special chars don't break the header.
  return `"${name.replace(/"/g, '\\"')}" <${address}>`;
}

export async function sendViaResend(
  settings: ContractEmailSettings,
  to: string,
  subject: string,
  html: string,
  attachments: Attachment[] = [],
): Promise<SendResult> {
  if (!settings.send_from_email) {
    throw new Error(
      "Resend send failed: contract_email_settings.send_from_email is empty. Set it in Settings → Contracts.",
    );
  }
  const resend = new Resend(requireResendKey());
  const { data, error } = await resend.emails.send({
    from: formatFromHeader(settings.send_from_name || "Contracts", settings.send_from_email),
    to,
    subject,
    html,
    replyTo: settings.reply_to_email || undefined,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    })),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  if (!data?.id) throw new Error("Resend did not return a message id");
  return { messageId: data.id, provider: "resend" };
}

export async function sendViaSmtp(
  supabase: SupabaseClient,
  accountId: string,
  settings: ContractEmailSettings,
  to: string,
  subject: string,
  html: string,
  attachments: Attachment[] = [],
): Promise<SendResult> {
  const { data: account, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !account) {
    throw new Error(`Email account ${accountId} not found for SMTP send`);
  }

  let password: string;
  try {
    password = decrypt(account.encrypted_password);
  } catch (e) {
    throw new Error(
      `Failed to decrypt email account password: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const fromName = settings.send_from_name || account.display_name || "Contracts";
  const fromEmail = settings.send_from_email || account.email_address;

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_port === 465,
    auth: { user: account.username, pass: password },
    tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
  });

  try {
    const info = await transporter.sendMail({
      from: formatFromHeader(fromName, fromEmail),
      to,
      replyTo: settings.reply_to_email || undefined,
      subject,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { messageId: info.messageId || `smtp-${Date.now()}`, provider: "smtp" };
  } finally {
    transporter.close();
  }
}

// Router: pick provider based on settings row. Throws if required config
// is missing so send paths can surface a useful error to the user.
export async function sendContractEmail(
  supabase: SupabaseClient,
  settings: ContractEmailSettings,
  args: {
    to: string;
    subject: string;
    html: string;
    attachments?: Attachment[];
  },
): Promise<SendResult> {
  const { to, subject, html, attachments = [] } = args;
  if (!to) throw new Error("sendContractEmail: 'to' address is required");
  if (!subject) throw new Error("sendContractEmail: 'subject' is required");

  if (settings.provider === "resend") {
    return sendViaResend(settings, to, subject, html, attachments);
  }

  if (settings.provider === "email_account") {
    if (!settings.email_account_id) {
      throw new Error(
        "Contract email settings use the email_account provider but no email_account_id is configured.",
      );
    }
    return sendViaSmtp(supabase, settings.email_account_id, settings, to, subject, html, attachments);
  }

  throw new Error(`Unknown contract email provider: ${settings.provider}`);
}

// Internal recipient for post-signing notifications. When using resend
// we don't have a connected mailbox to deliver to, so fall back to the
// reply-to address (preferred) or the send-from address.
export function resolveInternalRecipient(
  settings: ContractEmailSettings,
  emailAccountAddress: string | null,
): string {
  if (settings.provider === "email_account" && emailAccountAddress) {
    return emailAccountAddress;
  }
  return settings.reply_to_email || settings.send_from_email;
}
