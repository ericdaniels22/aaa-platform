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

export async function GET(req: NextRequest) {
  const gate = await requireAuthed(req);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
  const unreadOnly = searchParams.get("unread") === "1";

  const supabase = createServiceClient();
  let q = supabase
    .from("notifications")
    .select(
      "id, type, title, body, href, priority, read_at, metadata, created_at, user_profile_id",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is("read_at", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAuthed(req);
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as
    | { mark_all_read?: boolean }
    | null;
  if (!body?.mark_all_read) {
    return NextResponse.json(
      { error: "body must include { mark_all_read: true }" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
