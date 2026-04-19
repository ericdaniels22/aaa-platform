// src/app/api/accounting/damage-type/route.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireViewAccounting } from "@/lib/accounting/auth";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";
import { aggregateMargins } from "@/lib/accounting/margins";

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const range = resolveRange(preset);

  const supabase = await createServerSupabaseClient();
  const margins = await aggregateMargins(range.startISO, range.endISO, "all");

  const { data: jobs } = margins.length
    ? await supabase.from("jobs").select("id, damage_type").in("id", margins.map((m) => m.jobId))
    : { data: [] };
  const dtByJob = new Map<string, string>((jobs ?? []).map((j) => [j.id, j.damage_type ?? "other"]));

  type Bucket = {
    damage_type: string;
    job_count: number;
    revenue: number;
    expenses: number;
    margin: number;
    pct_sum: number;
    pct_n: number;
  };
  const bucket = new Map<string, Bucket>();
  for (const m of margins) {
    const dt = dtByJob.get(m.jobId) ?? "other";
    const b = bucket.get(dt) ?? {
      damage_type: dt,
      job_count: 0,
      revenue: 0,
      expenses: 0,
      margin: 0,
      pct_sum: 0,
      pct_n: 0,
    };
    b.job_count++;
    b.revenue += m.collected;
    b.expenses += m.expenses;
    b.margin += m.gross_margin;
    if (m.margin_pct !== null) {
      b.pct_sum += m.margin_pct;
      b.pct_n++;
    }
    bucket.set(dt, b);
  }

  const rows = Array.from(bucket.values())
    .map((b) => ({
      damage_type: b.damage_type,
      job_count: b.job_count,
      revenue: b.revenue,
      expenses: b.expenses,
      margin: b.margin,
      avg_margin_pct: b.pct_n > 0 ? b.pct_sum / b.pct_n : null,
    }))
    .sort((a, b) => b.margin - a.margin);

  return NextResponse.json({ rows });
}
