import { NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { resolveMergeFields } from "@/lib/contracts/merge-fields";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { generateSigningToken } from "@/lib/contracts/tokens";
import type { ContractEmailSettings } from "@/lib/contracts/types";

interface SendSignerInput {
  name: string;
  email: string;
  roleLabel?: string;
}

interface SendBody {
  jobId: string;
  templateId: string;
  signers: SendSignerInput[];
  expiryDays?: number;
  emailSubject: string;
  emailBody: string;
  title?: string;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

// POST /api/contracts/send
// Atomic-ish send pipeline:
//   1. Validate inputs + fetch template + fetch email settings
//   2. Resolve merge fields into filled HTML + SHA-256 hash
//   3. RPC create_contract_draft (contract + signer + 'created' event)
//   4. Send email via Resend or SMTP
//   5. RPC mark_contract_sent — only after email succeeds
// A send that fails at step 4 leaves a draft contract the user can Edit or
// Discard from the Contracts section.
export async function POST(request: Request) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SendBody | null;
  if (!body?.jobId || !body?.templateId || !Array.isArray(body?.signers) || !body.signers.length) {
    return NextResponse.json(
      { error: "jobId, templateId, and at least one signer are required" },
      { status: 400 },
    );
  }
  if (body.signers.length > 2) {
    return NextResponse.json({ error: "At most 2 signers" }, { status: 400 });
  }
  // 15b scope: single-signer only; multi-signer sequential flow is 15c.
  if (body.signers.length > 1) {
    return NextResponse.json(
      { error: "Multi-signer contracts will be available in Build 15c" },
      { status: 400 },
    );
  }
  const primary = body.signers[0];
  if (!primary.name || !primary.email) {
    return NextResponse.json(
      { error: "Signer name and email are required" },
      { status: 400 },
    );
  }
  if (!body.emailSubject || !body.emailBody) {
    return NextResponse.json(
      { error: "emailSubject and emailBody are required" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // --- Fetch settings (must have send-from configured) ---
  const { data: settings, error: sErr } = await supabase
    .from("contract_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<ContractEmailSettings>();
  if (sErr || !settings) {
    return NextResponse.json(
      { error: sErr?.message || "Contract email settings missing" },
      { status: 500 },
    );
  }
  if (!settings.send_from_email || !settings.send_from_name) {
    return NextResponse.json(
      {
        error:
          "Set a send-from email and display name in Settings → Contracts before sending.",
      },
      { status: 400 },
    );
  }

  // --- Fetch template ---
  const { data: tpl, error: tErr } = await supabase
    .from("contract_templates")
    .select("id, name, content_html, version, is_active, signer_role_label")
    .eq("id", body.templateId)
    .maybeSingle<{
      id: string;
      name: string;
      content_html: string;
      version: number;
      is_active: boolean;
      signer_role_label: string | null;
    }>();
  if (tErr || !tpl) {
    return NextResponse.json({ error: tErr?.message || "Template not found" }, { status: 404 });
  }
  if (!tpl.is_active) {
    return NextResponse.json({ error: "Template is archived" }, { status: 400 });
  }
  if (!tpl.content_html?.trim()) {
    return NextResponse.json({ error: "Template has no content" }, { status: 400 });
  }

  // --- Confirm the job exists ---
  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jErr || !job) {
    return NextResponse.json({ error: jErr?.message || "Job not found" }, { status: 404 });
  }

  // --- Resolve merge fields ---
  const { html: filledHtml } = await resolveMergeFields(supabase, tpl.content_html, body.jobId);
  const filledHash = createHash("sha256").update(filledHtml).digest("hex");

  // --- Compute IDs, token, expiry ---
  const contractId = randomUUID();
  const signerId = randomUUID();
  const expiryDays = Math.max(
    1,
    Math.min(30, body.expiryDays ?? settings.default_link_expiry_days),
  );
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const token = generateSigningToken({
    contractId,
    signerId,
    expiresAt,
  });

  const title = (body.title?.trim() || `${tpl.name} — ${primary.name}`).slice(0, 200);

  // --- Create draft (atomic RPC) ---
  const { error: rpcErr } = await supabase.rpc("create_contract_draft", {
    p_contract_id: contractId,
    p_signer_id: signerId,
    p_job_id: body.jobId,
    p_template_id: tpl.id,
    p_template_version: tpl.version,
    p_title: title,
    p_filled_content_html: filledHtml,
    p_filled_content_hash: filledHash,
    p_link_token: token,
    p_link_expires_at: expiresAt.toISOString(),
    p_signer_order: 1,
    p_signer_role_label: primary.roleLabel || tpl.signer_role_label || "Signer",
    p_signer_name: primary.name,
    p_signer_email: primary.email,
    p_sent_by: user.id,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Failed to create contract: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  // --- Resolve email body + send ---
  try {
    const signingLink = `${appUrl()}/sign/${token}`;
    const { subject, html } = await resolveEmailTemplate(
      supabase,
      body.emailSubject,
      body.emailBody,
      body.jobId,
      { signing_link: signingLink, document_title: title },
    );

    const sent = await sendContractEmail(supabase, settings, {
      to: primary.email,
      subject,
      html,
    });

    const { error: markErr } = await supabase.rpc("mark_contract_sent", {
      p_contract_id: contractId,
      p_message_id: sent.messageId,
      p_provider: sent.provider,
    });
    if (markErr) {
      return NextResponse.json(
        {
          error: `Email sent (message ${sent.messageId}) but failed to record status: ${markErr.message}`,
          contractId,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ contractId, messageId: sent.messageId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: `Contract draft created but email failed: ${msg}. Retry from the Contracts section.`,
        contractId,
      },
      { status: 502 },
    );
  }
}
