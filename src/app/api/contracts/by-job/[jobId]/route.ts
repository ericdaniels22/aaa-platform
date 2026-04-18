import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import type { ContractListItem } from "@/lib/contracts/types";

interface DbRow {
  id: string;
  title: string;
  status: string;
  sent_at: string | null;
  first_viewed_at: string | null;
  signed_at: string | null;
  link_expires_at: string | null;
  void_reason: string | null;
  signed_pdf_path: string | null;
  created_at: string;
  signers: Array<{ id: string; signer_order: number; name: string | null; ip_address: string | null }>;
}

// GET /api/contracts/by-job/[jobId] — list contracts for the job detail
// Overview tab's Contracts section. Includes just enough signer metadata
// for the status-driven row rendering (name + truncated IP for signed).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, title, status, sent_at, first_viewed_at, signed_at,
       link_expires_at, void_reason, signed_pdf_path, created_at,
       signers:contract_signers(id, signer_order, name, ip_address)`,
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: ContractListItem[] = (data ?? []).map((row) => {
    const r = row as unknown as DbRow;
    const primary = (r.signers ?? []).find((s) => s.signer_order === 1) ?? r.signers?.[0];
    return {
      id: r.id,
      title: r.title,
      status: r.status as ContractListItem["status"],
      sent_at: r.sent_at,
      first_viewed_at: r.first_viewed_at,
      signed_at: r.signed_at,
      link_expires_at: r.link_expires_at,
      void_reason: r.void_reason,
      signed_pdf_path: r.signed_pdf_path,
      primary_signer_name: primary?.name ?? null,
      primary_signer_ip: primary?.ip_address ?? null,
      signer_count: r.signers?.length ?? 0,
      created_at: r.created_at,
    };
  });
  return NextResponse.json(rows);
}
