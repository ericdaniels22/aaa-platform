import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { activityId } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from("expenses")
    .select(`
      *,
      vendor:vendors!vendor_id(id, name, vendor_type),
      category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
    `)
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
