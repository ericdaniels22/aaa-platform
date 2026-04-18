import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import { verifySigningToken, InvalidSigningTokenError } from "@/lib/contracts/tokens";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import type { Contract, ContractSigner, PublicSigningView } from "@/lib/contracts/types";

// GET /api/sign/[token]
// Public endpoint for the signing page. Validates the JWT, loads the
// contract + signer via service role (never touches RLS), logs the
// link_viewed event once per browser session (gated by a cookie keyed
// on the contract id), and returns the minimal view the signer needs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let payload: { contract_id: string; signer_id: string };
  try {
    payload = verifySigningToken(token);
  } catch (e) {
    if (e instanceof InvalidSigningTokenError) {
      return NextResponse.json({ error: "invalid_token", message: e.message }, { status: 401 });
    }
    throw e;
  }

  const supabase = createServiceClient();
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", payload.contract_id)
    .maybeSingle<Contract>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Token must match the stored row. If they diverge (e.g. after a resend),
  // the old link is no longer valid.
  if (contract.link_token !== token) {
    return NextResponse.json({ error: "stale_token" }, { status: 410 });
  }

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", payload.signer_id)
    .maybeSingle<ContractSigner>();
  if (!signer) {
    return NextResponse.json({ error: "signer_not_found" }, { status: 404 });
  }

  // Lazy expiry check — if the link has aged out, flip status + event.
  if (
    contract.link_expires_at &&
    (contract.status === "sent" || contract.status === "viewed") &&
    new Date(contract.link_expires_at).getTime() < Date.now()
  ) {
    await supabase.rpc("mark_contract_expired", { p_contract_id: contract.id });
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Voided / already signed short-circuits.
  if (contract.status === "voided") {
    return NextResponse.json({ error: "voided" }, { status: 410 });
  }

  // Collect company brand to render the header.
  const { data: companyRows } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const map = new Map<string, string | null>(
    (companyRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );

  // Log link_viewed (gated by a per-contract cookie so reloads don't
  // spam the audit trail) and update first/last view timestamps.
  const cookieName = `sv_${contract.id.slice(0, 8)}`;
  const cookieStore = await cookies();
  const hasViewedCookie = cookieStore.get(cookieName);

  if (!hasViewedCookie) {
    try {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "link_viewed",
        signerId: signer.id,
        ipAddress: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
      });
    } catch {
      // Audit failures must not block the signer from seeing their contract.
    }
    if (!contract.first_viewed_at) {
      await supabase
        .from("contracts")
        .update({
          first_viewed_at: new Date().toISOString(),
          status: contract.status === "sent" ? "viewed" : contract.status,
        })
        .eq("id", contract.id);
    }
  }
  await supabase
    .from("contracts")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", contract.id);

  const view: PublicSigningView = {
    contract: {
      id: contract.id,
      title: contract.title,
      filled_content_html: contract.filled_content_html,
      status: contract.status,
      link_expires_at: contract.link_expires_at,
      signed_at: contract.signed_at,
      signed_pdf_path: contract.signed_pdf_path,
    },
    signer: {
      id: signer.id,
      name: signer.name,
      role_label: signer.role_label,
    },
    company: {
      name: map.get("company_name") || "",
      phone: map.get("phone") || "",
      email: map.get("email") || "",
      address: map.get("address") || "",
      logo_url: map.get("logo_url") || null,
    },
  };

  const res = NextResponse.json(view);
  if (!hasViewedCookie && contract.link_expires_at) {
    const maxAge = Math.max(
      60,
      Math.floor((new Date(contract.link_expires_at).getTime() - Date.now()) / 1000),
    );
    res.cookies.set(cookieName, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });
  }
  return res;
}
