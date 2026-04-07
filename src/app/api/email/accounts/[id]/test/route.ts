import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { decrypt } from "@/lib/encryption";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

// POST /api/email/accounts/[id]/test — test IMAP and SMTP connections
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createApiClient();

  const { data: account, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const password = decrypt(account.encrypted_password);
  const results = { imap: false, smtp: false, imapError: "", smtpError: "" };

  // Test IMAP
  try {
    const client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_port === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      tls: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.logout();
    results.imap = true;
  } catch (err) {
    results.imapError = err instanceof Error ? err.message : "IMAP connection failed";
  }

  // Test SMTP
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.username, pass: password },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    transporter.close();
    results.smtp = true;
  } catch (err) {
    results.smtpError = err instanceof Error ? err.message : "SMTP connection failed";
  }

  return NextResponse.json(results);
}
