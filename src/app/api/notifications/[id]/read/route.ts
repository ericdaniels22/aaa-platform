import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireAuthed(_req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const, user: data.user };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuthed(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
