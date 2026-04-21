import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { requirePermission } from "@/lib/permissions-api";

export const runtime = "nodejs";

interface Body {
  secret: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const secretOrNull = body.secret;
  if (secretOrNull !== null && typeof secretOrNull !== "string") {
    return NextResponse.json(
      { error: "secret must be a string or null" },
      { status: 400 },
    );
  }
  if (typeof secretOrNull === "string" && !secretOrNull.startsWith("whsec_")) {
    return NextResponse.json(
      { error: "secret must start with whsec_" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const encryptedOrNull = secretOrNull ? encrypt(secretOrNull) : null;

  const { data: existing } = await supabase
    .from("stripe_connection")
    .select("id")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json(
      { error: "Connect Stripe before setting the webhook signing secret." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("stripe_connection")
    .update({ webhook_signing_secret_encrypted: encryptedOrNull })
    .eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
