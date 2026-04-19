import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

interface CreatePayload {
  job_id: string;
  vendor_id: string | null;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: "business_card" | "business_ach" | "cash" | "personal_reimburse" | "other";
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
}

async function requireLogExpenses() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false as const, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  if (profile.role === "admin") return { ok: true as const, userId: user.id, fullName: profile.full_name, role: profile.role };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "log_expenses").maybeSingle();
  if (perm?.granted) return { ok: true as const, userId: user.id, fullName: profile.full_name, role: profile.role };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function POST(request: Request) {
  const auth = await requireLogExpenses();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as CreatePayload;
  if (!body.job_id || !body.category_id || !body.vendor_name || typeof body.amount !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("create_expense_with_activity", {
    p_job_id: body.job_id,
    p_vendor_id: body.vendor_id,
    p_vendor_name: body.vendor_name,
    p_category_id: body.category_id,
    p_amount: body.amount,
    p_expense_date: body.expense_date,
    p_payment_method: body.payment_method,
    p_description: body.description,
    p_receipt_path: body.receipt_path,
    p_thumbnail_path: body.thumbnail_path,
    p_submitted_by: auth.userId,
    p_submitter_name: auth.fullName,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data }, { status: 201 });
}
