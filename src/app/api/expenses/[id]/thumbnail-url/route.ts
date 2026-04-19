import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();
  const { data: expense } = await service.from("expenses").select("thumbnail_path").eq("id", id).maybeSingle();
  if (!expense?.thumbnail_path) return NextResponse.json({ error: "No thumbnail" }, { status: 404 });

  const { data, error } = await service.storage.from("receipts").createSignedUrl(expense.thumbnail_path, 600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + 600 * 1000).toISOString() });
}
