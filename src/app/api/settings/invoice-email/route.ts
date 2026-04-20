// GET /api/settings/invoice-email   — returns the singleton row.
// PATCH /api/settings/invoice-email — updates allowed fields.
//
// Auth: admin required. DB access uses the service client so the admin-only
// RLS policy on invoice_email_settings doesn't need to resolve auth.uid().

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";
import type { InvoiceEmailProvider, InvoiceEmailSettings } from "@/lib/qb/types";

async function getSettings() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("invoice_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<InvoiceEmailSettings>();
  return { supabase, data, error };
}

export async function GET() {
  const auth = await createServerSupabaseClient();
  const gate = await requireAdmin(auth);
  if (!gate.ok) return gate.response;

  const { data, error } = await getSettings();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "invoice_email_settings row missing — did the build38 migration run?" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const auth = await createServerSupabaseClient();
  const gate = await requireAdmin(auth);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as Partial<InvoiceEmailSettings> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { supabase, data: current } = await getSettings();
  if (!current) return NextResponse.json({ error: "settings missing" }, { status: 500 });

  const patch: Partial<InvoiceEmailSettings> = {};
  const strFields: Array<keyof InvoiceEmailSettings> = [
    "send_from_email",
    "send_from_name",
    "reply_to_email",
    "subject_template",
    "body_template",
  ];
  for (const f of strFields) {
    if (body[f] === null || typeof body[f] === "string") {
      (patch as Record<string, unknown>)[f] = body[f] || null;
    }
  }
  if (body.provider === "resend" || body.provider === "email_account") {
    patch.provider = body.provider as InvoiceEmailProvider;
  }
  if (body.email_account_id === null || typeof body.email_account_id === "string") {
    patch.email_account_id = body.email_account_id || null;
  }

  if (patch.provider === "email_account" && !patch.email_account_id && !current.email_account_id) {
    return NextResponse.json(
      { error: "Select an email account before switching provider to email_account" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("invoice_email_settings")
    .update(patch)
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
