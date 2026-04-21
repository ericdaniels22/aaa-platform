import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

async function getCallerAndExpense(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Not authenticated" };

  const orgId = getActiveOrganizationId();
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string; role: string }>();

  const service = createServiceClient();
  const { data: expense } = await service.from("expenses")
    .select("id, submitted_by, receipt_path, thumbnail_path, activity_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!expense) return { ok: false as const, status: 404, error: "Expense not found" };

  const isAdmin = membership?.role === "admin";
  const isSubmitter = expense.submitted_by === user.id;
  if (!isAdmin && !isSubmitter) return { ok: false as const, status: 403, error: "Permission denied" };

  // Also require log_expenses (defence in depth — submitters were granted this by role, but double check).
  if (!isAdmin) {
    const { data: perm } = await supabase
      .from("user_organization_permissions")
      .select("granted")
      .eq("user_organization_id", membership?.id ?? "")
      .eq("permission_key", "log_expenses")
      .maybeSingle();
    if (!perm?.granted) return { ok: false as const, status: 403, error: "Permission denied" };
  }

  return { ok: true as const, user, expense, service };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCallerAndExpense(id);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await request.json();
  const { error } = await caller.service.rpc("update_expense", {
    p_expense_id: id,
    p_vendor_id: body.vendor_id,
    p_vendor_name: body.vendor_name,
    p_category_id: body.category_id,
    p_amount: body.amount,
    p_expense_date: body.expense_date,
    p_payment_method: body.payment_method,
    p_description: body.description,
    p_receipt_path: body.receipt_path,
    p_thumbnail_path: body.thumbnail_path,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the photo was replaced, delete the old objects (caller provides the previous paths as query params).
  const { searchParams } = new URL(request.url);
  const oldReceipt = searchParams.get("old_receipt");
  const oldThumb = searchParams.get("old_thumb");
  const toRemove = [oldReceipt, oldThumb].filter((p): p is string => Boolean(p)
    && p !== body.receipt_path && p !== body.thumbnail_path);
  if (toRemove.length) await caller.service.storage.from("receipts").remove(toRemove);

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCallerAndExpense(id);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { data, error } = await caller.service.rpc("delete_expense_cascade", { p_expense_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Storage cleanup — best effort; orphans are acceptable per spec.
  const row = Array.isArray(data) ? data[0] : data;
  const paths = [row?.receipt_path, row?.thumbnail_path].filter((p): p is string => Boolean(p));
  if (paths.length) {
    const { error: rmErr } = await caller.service.storage.from("receipts").remove(paths);
    if (rmErr) console.warn("receipts cleanup failed after expense delete", { id, paths, rmErr });
  }

  return NextResponse.json({ success: true });
}
