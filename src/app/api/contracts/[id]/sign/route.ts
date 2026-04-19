import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { verifySigningToken, InvalidSigningTokenError, generateSigningToken } from "@/lib/contracts/tokens";
import { generateSignedPdf } from "@/lib/contracts/pdf";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail, resolveInternalRecipient } from "@/lib/contracts/email";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { computeInitialNextReminderAt } from "@/lib/contracts/reminders";
import type {
  Contract,
  ContractSigner,
  ContractEmailSettings,
} from "@/lib/contracts/types";

interface SignBody {
  // Remote (token) mode:
  token?: string;
  // In-person (session auth) mode:
  in_person?: boolean;
  signerId?: string;
  // Common:
  signatureDataUrl: string;
  typedName: string;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

// POST /api/contracts/[id]/sign
// Two auth modes:
//   Remote  — body.token is a signed JWT (magic-link flow).
//   In-person — body.in_person=true + authenticated session. Used by the
//     tablet signing view; no token needed because the user sits at an
//     Eric/tech's iPad and is already logged in.
//
// Signing happens in three phases:
//   1. Upload the PNG + record_signer_signature RPC (atomic signer update
//      + 'signed' event).
//   2. If more signers remain: in-person → no-op (tablet swaps to next);
//      remote → generate next signer's token, activate_next_signer RPC,
//      send the signing-request email to that signer, schedule their
//      first reminder.
//   3. If all signers are done: generate the PDF, upload it, mark the
//      contract signed, dispatch customer + internal confirmation emails.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contractId } = await params;
  const body = (await request.json().catch(() => null)) as SignBody | null;
  if (!body?.signatureDataUrl || !body?.typedName) {
    return NextResponse.json(
      { error: "signatureDataUrl and typedName are required" },
      { status: 400 },
    );
  }

  const inPerson = body.in_person === true;
  let signerId: string;

  if (inPerson) {
    if (!body.signerId) {
      return NextResponse.json(
        { error: "signerId is required for in_person mode" },
        { status: 400 },
      );
    }
    // Auth: in-person mode requires a logged-in platform user.
    const authClient = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    signerId = body.signerId;
  } else {
    if (!body.token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    let payload;
    try {
      payload = verifySigningToken(body.token);
    } catch (e) {
      if (e instanceof InvalidSigningTokenError) {
        return NextResponse.json({ error: "invalid_token" }, { status: 401 });
      }
      throw e;
    }
    if (payload.contract_id !== contractId) {
      return NextResponse.json({ error: "token_mismatch" }, { status: 401 });
    }
    signerId = payload.signer_id;
  }

  const supabase = createServiceClient();

  const { data: contract, error: cErr } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle<Contract>();
  if (cErr || !contract) {
    return NextResponse.json({ error: cErr?.message || "Contract not found" }, { status: 404 });
  }
  if (contract.status === "voided") {
    return NextResponse.json({ error: "voided" }, { status: 410 });
  }
  if (contract.status === "signed") {
    return NextResponse.json({ error: "already_signed" }, { status: 409 });
  }
  if (!inPerson) {
    // Remote flow: enforce token freshness + expiry.
    if (contract.link_token !== body.token) {
      return NextResponse.json({ error: "stale_token" }, { status: 410 });
    }
    if (
      contract.link_expires_at &&
      new Date(contract.link_expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: "expired" }, { status: 410 });
    }
  } else {
    // In-person flow: contract must still be draft or in-flight. The
    // normal path is draft → signed (skipping sent/viewed).
    if (!["draft", "sent", "viewed"].includes(contract.status)) {
      return NextResponse.json(
        { error: `Contract cannot be signed from status '${contract.status}'` },
        { status: 409 },
      );
    }
  }

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", signerId)
    .maybeSingle<ContractSigner>();
  if (!signer || signer.contract_id !== contract.id) {
    return NextResponse.json({ error: "signer_not_found" }, { status: 404 });
  }
  if (signer.signed_at) {
    return NextResponse.json({ error: "already_signed" }, { status: 409 });
  }

  // --- Decode signature PNG ---
  const match = body.signatureDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    return NextResponse.json(
      { error: "signatureDataUrl must be a data URL of type image/png" },
      { status: 400 },
    );
  }
  const pngBytes = Buffer.from(match[1], "base64");
  if (pngBytes.length < 200) {
    return NextResponse.json({ error: "Signature image is empty" }, { status: 400 });
  }

  const path = `${contract.job_id}/${contract.id}/signatures/signer-${signer.signer_order}.png`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(path, pngBytes, {
      contentType: "image/png",
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `Failed to upload signature: ${upErr.message}` },
      { status: 500 },
    );
  }

  const ip = getRequestIp(request);
  const ua = getRequestUserAgent(request);

  const { data: rpcRows, error: rpcErr } = await supabase.rpc("record_signer_signature", {
    p_signer_id: signer.id,
    p_typed_name: body.typedName,
    p_ip_address: ip,
    p_user_agent: ua,
    p_signature_image_path: path,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Failed to record signature: ${rpcErr.message}` },
      { status: 500 },
    );
  }
  const allSigned = Array.isArray(rpcRows) && rpcRows[0]?.all_signed === true;

  // --- Not all signers done → sequential handoff ---
  if (!allSigned) {
    // Load remaining signers so we know who's next.
    const { data: signersAll } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract.id)
      .order("signer_order");
    const nextSigner =
      (signersAll as ContractSigner[] | null)?.find((s) => !s.signed_at) ?? null;

    if (!nextSigner) {
      // Shouldn't happen — allSigned would be true — but fail safe.
      return NextResponse.json({ ok: true, finalized: false });
    }

    if (inPerson) {
      // Tablet handoff: no email, no token rotation. The tablet page swaps
      // to the next signer using the returned info.
      return NextResponse.json({
        ok: true,
        finalized: false,
        nextSigner: {
          id: nextSigner.id,
          name: nextSigner.name,
          role_label: nextSigner.role_label,
          signer_order: nextSigner.signer_order,
        },
      });
    }

    // Remote multi-signer: generate next signer's token, rotate
    // contracts.link_token, email them, schedule first reminder.
    try {
      const { data: settings } = await supabase
        .from("contract_email_settings")
        .select("*")
        .limit(1)
        .maybeSingle<ContractEmailSettings>();
      if (!settings) throw new Error("contract_email_settings row missing");

      const expiryDays = Math.max(
        1,
        Math.min(30, settings.default_link_expiry_days),
      );
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
      const newToken = generateSigningToken({
        contractId: contract.id,
        signerId: nextSigner.id,
        expiresAt,
      });

      const { error: actErr } = await supabase.rpc("activate_next_signer", {
        p_contract_id: contract.id,
        p_next_signer_id: nextSigner.id,
        p_link_token: newToken,
        p_link_expires_at: expiresAt.toISOString(),
      });
      if (actErr) throw new Error(actErr.message);

      const { subject, html } = await resolveEmailTemplate(
        supabase,
        settings.signing_request_subject_template,
        settings.signing_request_body_template,
        contract.job_id,
        {
          signing_link: `${appUrl()}/sign/${newToken}`,
          document_title: contract.title,
        },
      );
      await sendContractEmail(supabase, settings, {
        to: nextSigner.email,
        subject,
        html,
      });

      // Schedule signer 2's first auto-reminder.
      const firstReminder = computeInitialNextReminderAt(
        new Date(),
        settings.reminder_day_offsets,
      );
      if (firstReminder) {
        await supabase.rpc("schedule_first_reminder", {
          p_contract_id: contract.id,
          p_next_reminder_at: firstReminder.toISOString(),
        });
      }
    } catch (e) {
      // Activation/email failure is logged via audit; the customer-facing
      // signer 1 submission still succeeded (their signature is recorded).
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "next_signer_activation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, finalized: false });
  }

  // --- All signers done → finalize: PDF + confirmation emails ---
  try {
    const [{ data: signersAll }, { data: settings }, { data: companyRows }, { data: jobRow }] =
      await Promise.all([
        supabase
          .from("contract_signers")
          .select("*")
          .eq("contract_id", contract.id)
          .order("signer_order"),
        supabase
          .from("contract_email_settings")
          .select("*")
          .limit(1)
          .maybeSingle<ContractEmailSettings>(),
        supabase
          .from("company_settings")
          .select("key, value")
          .in("key", ["company_name", "phone", "email", "address", "license"]),
        supabase
          .from("jobs")
          .select("id, job_number, contact_id")
          .eq("id", contract.job_id)
          .maybeSingle(),
      ]);

    if (!settings) throw new Error("contract_email_settings row missing");
    if (!signersAll) throw new Error("Unable to reload signers for PDF generation");

    const companyMap = new Map<string, string | null>(
      (companyRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
    );

    const sigEntries = [] as Array<{ signer: ContractSigner; signaturePng: Uint8Array }>;
    for (const s of signersAll as ContractSigner[]) {
      if (!s.signature_image_path) continue;
      const dl = await supabase.storage.from("contracts").download(s.signature_image_path);
      if (!dl.data) throw new Error(`Failed to load signature image for signer ${s.id}`);
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      sigEntries.push({ signer: s, signaturePng: buf });
    }

    const freshContract = { ...contract, signed_at: new Date().toISOString() };
    const pdfBytes = await generateSignedPdf({
      contract: freshContract,
      signatures: sigEntries,
      company: {
        name: companyMap.get("company_name") || "",
        phone: companyMap.get("phone") || "",
        email: companyMap.get("email") || "",
        address: companyMap.get("address") || "",
        license: companyMap.get("license") || "",
      },
    });

    const pdfPath = `${contract.job_id}/${contract.id}.pdf`;
    const { error: pdfUpErr } = await supabase.storage
      .from("contracts")
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (pdfUpErr) throw new Error(`PDF upload failed: ${pdfUpErr.message}`);

    const { error: markErr } = await supabase.rpc("mark_contract_signed", {
      p_contract_id: contract.id,
      p_pdf_path: pdfPath,
    });
    if (markErr) throw new Error(`Failed to mark contract signed: ${markErr.message}`);

    // --- Post-signing confirmation emails (best-effort, same as 15b) ---
    const pdfAttachment = {
      filename: `${contract.title.replace(/[\\/:*?"<>|]/g, "_")}.pdf`,
      content: Buffer.from(pdfBytes),
      contentType: "application/pdf",
    };

    // Send customer confirmation to signer 1 (primary).
    const primarySigner =
      (signersAll as ContractSigner[]).find((s) => s.signer_order === 1) ??
      (signersAll as ContractSigner[])[0];

    try {
      const customer = await resolveEmailTemplate(
        supabase,
        settings.signed_confirmation_subject_template,
        settings.signed_confirmation_body_template,
        contract.job_id,
        { signing_link: "", document_title: contract.title },
      );
      await sendContractEmail(supabase, settings, {
        to: primarySigner.email,
        subject: customer.subject,
        html: customer.html,
        attachments: [pdfAttachment],
      });
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: { kind: "customer_confirmation" },
      });
    } catch (e) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "customer_confirmation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
    }

    try {
      let internalAddress: string | null = null;
      if (settings.provider === "email_account" && settings.email_account_id) {
        const { data: acct } = await supabase
          .from("email_accounts")
          .select("email_address")
          .eq("id", settings.email_account_id)
          .maybeSingle<{ email_address: string }>();
        internalAddress = acct?.email_address ?? null;
      }
      const internalTo = resolveInternalRecipient(settings, internalAddress);
      if (internalTo) {
        const internal = await resolveEmailTemplate(
          supabase,
          settings.signed_confirmation_internal_subject_template,
          settings.signed_confirmation_internal_body_template,
          contract.job_id,
          {
            signing_link: "",
            document_title: contract.title,
            contract_platform_url: `${appUrl()}/jobs/${contract.job_id}`,
          },
        );
        await sendContractEmail(supabase, settings, {
          to: internalTo,
          subject: internal.subject,
          html: internal.html,
          attachments: [pdfAttachment],
        });
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          metadata: { kind: "internal_confirmation" },
        });
      }
    } catch (e) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "internal_confirmation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
    }

    void jobRow;
    // Quiet an unused-binding warning when randomUUID isn't referenced
    // in a given code-path. It IS used below via generateSigningToken.
    void randomUUID;

    return NextResponse.json({ ok: true, finalized: true, pdfPath });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Signature recorded but PDF/finalization failed: ${e instanceof Error ? e.message : String(e)}`,
        finalized: false,
      },
      { status: 500 },
    );
  }
}
