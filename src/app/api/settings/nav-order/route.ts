import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/settings/nav-order — returns the admin-configured order.
// Any signed-in user can read (RLS enforces this).
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("nav_items")
    .select("href, sort_order")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// PUT /api/settings/nav-order — admin-only. Body: { order: string[] }
// where `order` is an array of hrefs in the desired display order.
// Upserts each href with sort_order = index + 1.
export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Admin check (defense-in-depth; RLS also enforces this)
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const order = (body as { order?: unknown })?.order;
  if (!Array.isArray(order)) {
    return NextResponse.json(
      { error: "order must be an array" },
      { status: 400 }
    );
  }
  for (const href of order) {
    if (typeof href !== "string" || href.length === 0) {
      return NextResponse.json(
        { error: "order must contain non-empty strings" },
        { status: 400 }
      );
    }
  }

  // Upsert each href with its new sort_order
  const rows = (order as string[]).map((href, i) => ({
    href,
    sort_order: i + 1,
  }));

  const { error } = await supabase
    .from("nav_items")
    .upsert(rows, { onConflict: "href" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
