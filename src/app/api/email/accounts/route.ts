import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";

// GET /api/email/accounts — list all email accounts (passwords excluded)
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, last_synced_at, last_synced_uid, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// POST /api/email/accounts — add a new email account
export async function POST(request: Request) {
  const body = await request.json();
  const { label, email_address, display_name, provider, imap_host, imap_port, smtp_host, smtp_port, username, password } = body;

  if (!email_address || !username || !password) {
    return NextResponse.json(
      { error: "email_address, username, and password are required" },
      { status: 400 }
    );
  }

  const encrypted_password = encrypt(password);

  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .insert({
      label: label || email_address,
      email_address,
      display_name: display_name || "AAA Disaster Recovery",
      provider: provider || "custom",
      imap_host: imap_host || "imap.hostinger.com",
      imap_port: imap_port || 993,
      smtp_host: smtp_host || "smtp.hostinger.com",
      smtp_port: smtp_port || 465,
      username,
      encrypted_password,
    })
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
