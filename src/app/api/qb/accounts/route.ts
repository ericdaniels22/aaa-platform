import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";
import { getValidAccessToken } from "@/lib/qb/tokens";
import { listDepositAccounts } from "@/lib/qb/client";

// GET /api/qb/accounts — returns active QB Accounts of type Bank or
// Other Current Asset for the payment-method mapping dropdown.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return gate.response;

  const service = createServiceClient();
  const token = await getValidAccessToken(service);
  if (!token) {
    return NextResponse.json(
      { error: "no active connection" },
      { status: 400 },
    );
  }
  try {
    const accounts = await listDepositAccounts(token);
    return NextResponse.json({ accounts });
  } catch (err) {
    const anyErr = err as { message?: string; status?: number; code?: string; detail?: string; raw?: unknown };
    console.error("[qb/accounts]", { message: anyErr?.message, status: anyErr?.status, code: anyErr?.code, detail: anyErr?.detail, raw: anyErr?.raw });
    return NextResponse.json(
      {
        error: anyErr?.message ?? "QB API error",
        status: anyErr?.status,
        code: anyErr?.code,
        detail: anyErr?.detail,
      },
      { status: 502 },
    );
  }
}
