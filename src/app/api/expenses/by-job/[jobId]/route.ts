import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { jobId } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from("expenses")
    .select(`
      *,
      vendor:vendors!vendor_id(id, name, vendor_type),
      category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
    `)
    .eq("job_id", jobId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
