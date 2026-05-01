import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Estimate,
  EstimateLineItem,
  EstimateSection,
  EstimateWithContents,
} from "@/lib/types";
import { round2 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Numbering — atomic per-job sequence via RPC (uses SELECT FOR UPDATE in SQL)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateEstimateNumber(
  jobId: string,
  supabase: SupabaseClient,
): Promise<{ estimate_number: string; sequence_number: number }> {
  const { data, error } = await supabase
    .rpc("generate_estimate_number", { p_job_id: jobId });
  if (error) throw new Error(`generate_estimate_number failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("generate_estimate_number returned no row");
  return data[0] as { estimate_number: string; sequence_number: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaded fetch — returns estimate + sections (one level of nesting) + items
// ─────────────────────────────────────────────────────────────────────────────

export async function getEstimateWithContents(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<EstimateWithContents | null> {
  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .maybeSingle<Estimate>();
  if (estErr) throw new Error(`getEstimate failed: ${estErr.message}`);
  if (!estimate) return null;

  const { data: sections, error: secErr } = await supabase
    .from("estimate_sections")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateSection[]>();
  if (secErr) throw new Error(`getSections failed: ${secErr.message}`);

  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateLineItem[]>();
  if (itemErr) throw new Error(`getLineItems failed: ${itemErr.message}`);

  const allSections = sections ?? [];
  const allItems = items ?? [];
  const topLevel = allSections.filter((s) => s.parent_section_id === null);
  const subsByParent = new Map<string, EstimateSection[]>();
  for (const s of allSections) {
    if (s.parent_section_id) {
      const arr = subsByParent.get(s.parent_section_id) ?? [];
      arr.push(s);
      subsByParent.set(s.parent_section_id, arr);
    }
  }
  const itemsBySection = new Map<string, EstimateLineItem[]>();
  for (const it of allItems) {
    const arr = itemsBySection.get(it.section_id) ?? [];
    arr.push(it);
    itemsBySection.set(it.section_id, arr);
  }

  return {
    ...estimate,
    sections: topLevel.map((sec) => ({
      ...sec,
      items: itemsBySection.get(sec.id) ?? [],
      subsections: (subsByParent.get(sec.id) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((sub) => ({
          ...sub,
          items: itemsBySection.get(sub.id) ?? [],
        })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// recalculateTotals — server source of truth
// Called after every mutation that affects line items, markup, discount, or tax.
// Does NOT use a multi-statement transaction (Supabase JS limitation); the
// final UPDATE is the only writer of the cached values, and reads happen
// fresh in this function, so concurrent recalc calls converge.
// ─────────────────────────────────────────────────────────────────────────────

export async function recalculateTotals(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<void> {
  // 1. Fetch line items
  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("id, quantity, unit_price, total")
    .eq("estimate_id", estimateId);
  if (itemErr) throw new Error(`recalc fetch items: ${itemErr.message}`);

  // 2. Defensive: write back any drifted line totals
  const lineUpdates: Array<{ id: string; total: number }> = [];
  for (const li of (items ?? []) as Array<{ id: string; quantity: number; unit_price: number; total: number }>) {
    const want = round2(Number(li.quantity) * Number(li.unit_price));
    if (want !== Number(li.total)) {
      lineUpdates.push({ id: li.id, total: want });
    }
  }
  if (lineUpdates.length > 0) {
    for (const u of lineUpdates) {
      const { error } = await supabase
        .from("estimate_line_items")
        .update({ total: u.total })
        .eq("id", u.id);
      if (error) throw new Error(`recalc write line: ${error.message}`);
    }
  }

  // 3. Subtotal from authoritative line totals
  const subtotal = round2(
    ((items ?? []) as Array<{ quantity: number; unit_price: number }>)
      .reduce((acc, li) => acc + Number(li.quantity) * Number(li.unit_price), 0),
  );

  // 4. Load adjustment fields
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .select("markup_type, markup_value, discount_type, discount_value, tax_rate")
    .eq("id", estimateId)
    .maybeSingle<{
      markup_type: "percent" | "amount" | "none";
      markup_value: number;
      discount_type: "percent" | "amount" | "none";
      discount_value: number;
      tax_rate: number;
    }>();
  if (estErr) throw new Error(`recalc fetch est: ${estErr.message}`);
  if (!est) throw new Error(`estimate ${estimateId} not found during recalc`);

  // 5. Markup
  let markup_amount = 0;
  if (est.markup_type === "amount") markup_amount = round2(Number(est.markup_value));
  else if (est.markup_type === "percent") markup_amount = round2(subtotal * Number(est.markup_value) / 100);

  // 6. Discount
  let discount_amount = 0;
  if (est.discount_type === "amount") discount_amount = round2(Number(est.discount_value));
  else if (est.discount_type === "percent") discount_amount = round2(subtotal * Number(est.discount_value) / 100);

  // 7. Adjusted subtotal
  const adjusted_subtotal = round2(subtotal + markup_amount - discount_amount);

  // 8. Tax
  const tax_amount = round2(adjusted_subtotal * Number(est.tax_rate) / 100);

  // 9. Total
  const total = round2(adjusted_subtotal + tax_amount);

  // 10. Write back
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      subtotal,
      markup_amount,
      discount_amount,
      adjusted_subtotal,
      tax_amount,
      total,
    })
    .eq("id", estimateId);
  if (updErr) throw new Error(`recalc write totals: ${updErr.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// One-level-only nesting validation
// ─────────────────────────────────────────────────────────────────────────────

export async function assertSectionDepth(
  parentSectionId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase
    .from("estimate_sections")
    .select("parent_section_id")
    .eq("id", parentSectionId)
    .maybeSingle<{ parent_section_id: string | null }>();
  if (error) throw new Error(`assertSectionDepth: ${error.message}`);
  if (!data) throw new Error("parent section not found");
  if (data.parent_section_id !== null) {
    throw new Error("Sections cannot nest more than one level deep");
  }
}
