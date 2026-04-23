import { CheckCircle2 } from "lucide-react";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";
import { AAA_ORGANIZATION_ID } from "@/lib/supabase/get-active-org";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  logoUrl: string | null;
}

// Public post-payment page; same AAA-fallback rationale as sign/[token].
async function loadCompany(): Promise<CompanyBrand> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", AAA_ORGANIZATION_ID)
    .in("key", ["company_name", "phone", "email", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [
      r.key,
      r.value,
    ]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    logoUrl: m.get("logo_url") || null,
  };
}

export default async function PaySuccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Token-verify only for safety (don't want this page to render without a
  // real token in the URL). Do NOT touch payment_requests status here.
  try {
    verifyPaymentLinkToken(token);
  } catch (e) {
    if (!(e instanceof InvalidPaymentLinkTokenError)) throw e;
    // Even if the token is invalid/expired we still render the thank-you
    // page — the customer may have successfully paid, which consumes the
    // window but shouldn't show a scary error.
  }
  const company = await loadCompany();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg mx-auto mb-4"
          />
        ) : null}
        <CheckCircle2
          size={48}
          className="mx-auto mb-3"
          style={{ color: "#0f6e56" }}
        />
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          Payment submitted
        </h1>
        <p className="text-sm public-muted mb-6">
          Thank you &mdash; we&apos;ll send a receipt by email shortly. You can
          close this page.
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}
