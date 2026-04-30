import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import { verifySigningToken, InvalidSigningTokenError } from "@/lib/contracts/tokens";
import { writeContractEvent } from "@/lib/contracts/audit";
import type { Contract, ContractSigner } from "@/lib/contracts/types";
import SigningForm from "./signing-form";
import { Lock } from "lucide-react";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string | null;
}

const EMPTY_BRAND: CompanyBrand = {
  name: "",
  phone: "",
  email: "",
  address: "",
  logoUrl: null,
};

// Multi-tenant rule (18c): branding is scoped to the contract's
// organization_id. There is intentionally no AAA fallback. When orgId is
// null (token didn't verify, or contract row not found) we render the error
// shell with no branding rather than misattribute the link to AAA.
async function loadCompany(orgId: string | null): Promise<CompanyBrand> {
  if (!orgId) return EMPTY_BRAND;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", orgId)
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    address: m.get("address") || "",
    logoUrl: m.get("logo_url") || null,
  };
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let payload: { contract_id: string; signer_id: string };
  try {
    payload = verifySigningToken(token);
  } catch (e) {
    const reason = e instanceof InvalidSigningTokenError ? e.message : "Invalid link";
    // Pre-token-verify failure: no row to derive an org from. Render with
    // no branding rather than guess.
    return <ErrorShell title="This link is invalid" subtitle={reason} company={EMPTY_BRAND} />;
  }

  // Fetch contract + signer first so we can scope company branding to the
  // contract's organization. Anonymous queries via the service-role client
  // bypass RLS — the link_token in the JWT is the credential.
  const supabase = createServiceClient();
  const [{ data: contract }, { data: signer }] = await Promise.all([
    supabase
      .from("contracts")
      .select("*")
      .eq("id", payload.contract_id)
      .maybeSingle<Contract>(),
    supabase
      .from("contract_signers")
      .select("*")
      .eq("id", payload.signer_id)
      .maybeSingle<ContractSigner>(),
  ]);

  const company = await loadCompany(contract?.organization_id ?? null);

  if (!contract || !signer) {
    return <ErrorShell title="Document not found" subtitle="This signing link is no longer valid." company={company} />;
  }
  if (contract.link_token !== token) {
    return (
      <ErrorShell
        title="This link has been replaced"
        subtitle="A newer signing link was sent for this contract. Check your most recent email from the sender."
        company={company}
      />
    );
  }
  if (contract.status === "voided") {
    return (
      <ErrorShell
        title="This contract has been voided"
        subtitle="Contact the sender if you believe this is an error."
        company={company}
      />
    );
  }
  if (
    contract.status === "sent" ||
    contract.status === "viewed"
  ) {
    if (
      contract.link_expires_at &&
      new Date(contract.link_expires_at).getTime() < Date.now()
    ) {
      await supabase.rpc("mark_contract_expired", { p_contract_id: contract.id });
      return (
        <ErrorShell
          title="This signing link has expired"
          subtitle="Contact the sender to have a fresh link issued."
          company={company}
        />
      );
    }
  }

  if (contract.status === "signed") {
    return <SignedShell contract={contract} company={company} />;
  }

  // --- Log first-view ---
  // Dedup uses the first_viewed_at column rather than a cookie:
  // Next.js Server Components can't write cookies (only Server Actions
  // or Route Handlers can). Duplicate "link_viewed" events on reload are
  // acceptable as long as first/last view timestamps stay accurate.
  const h = await headers();
  if (!contract.first_viewed_at) {
    try {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "link_viewed",
        signerId: signer.id,
        ipAddress: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null,
        userAgent: h.get("user-agent"),
      });
    } catch {
      // Audit write failures do not block the signer.
    }
    await supabase
      .from("contracts")
      .update({
        first_viewed_at: new Date().toISOString(),
        status: contract.status === "sent" ? "viewed" : contract.status,
      })
      .eq("id", contract.id);
  }
  await supabase
    .from("contracts")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", contract.id);

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <HeaderBlock company={company} />
        <SigningForm
          contract={{
            id: contract.id,
            title: contract.title,
            filled_content_html: contract.filled_content_html,
          }}
          signer={{ id: signer.id, name: signer.name, role_label: signer.role_label }}
          token={token}
        />
        <AuditFooter />
      </div>
    </div>
  );
}

// ---------- Status shells ----------

function HeaderBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mb-6">
      <div className="flex items-start gap-3">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg"
          />
        ) : null}
        <div className="flex-1">
          <div className="text-lg font-semibold" style={{ color: "#111827" }}>
            {company.name || "Contract Signing"}
          </div>
          {(company.phone || company.email) && (
            <div className="text-sm public-muted">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs public-muted">
          <Lock size={12} />
          Secure signing powered by Nookleus
        </div>
      </div>
    </div>
  );
}

function AuditFooter() {
  return (
    <p className="text-[11px] text-center public-muted mt-6">
      This signing session is secure · IP logged for audit purposes · Document hash verified
    </p>
  );
}

function ErrorShell({
  title,
  subtitle,
  company,
}: {
  title: string;
  subtitle: string;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2" style={{ color: "#111827" }}>
          {title}
        </h1>
        <p className="text-sm public-muted mb-6">{subtitle}</p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            Contact the sender: {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}

function SignedShell({
  contract,
  company,
}: {
  contract: Contract;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2" style={{ color: "#111827" }}>
          This contract has been signed
        </h1>
        <p className="text-sm public-muted mb-6">
          {contract.title} — signed {contract.signed_at ? new Date(contract.signed_at).toLocaleDateString() : ""}.
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
          </div>
        )}
      </div>
    </div>
  );
}
