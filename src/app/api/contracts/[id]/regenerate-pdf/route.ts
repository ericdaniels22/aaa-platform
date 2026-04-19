import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { generateSignedPdf } from "@/lib/contracts/pdf";
import type { Contract, ContractSigner } from "@/lib/contracts/types";

// POST /api/contracts/[id]/regenerate-pdf
// Re-renders the signed PDF for an already-signed contract using the
// stored signatures and current PDF code. Useful after a PDF-layer bug
// fix (e.g. the signature-ink recolor in Build 34+) without having to
// void + resign. Writes the new PDF over the existing signed_pdf_path.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: contract } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .maybeSingle<Contract>();
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (contract.status !== "signed" || !contract.signed_pdf_path) {
    return NextResponse.json(
      { error: "Contract must be signed with a PDF on file" },
      { status: 409 },
    );
  }

  const [{ data: signers }, { data: companyRows }] = await Promise.all([
    supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract.id)
      .order("signer_order"),
    supabase
      .from("company_settings")
      .select("key, value")
      .in("key", ["company_name", "phone", "email", "address", "license"]),
  ]);

  if (!signers?.length) {
    return NextResponse.json({ error: "No signers found" }, { status: 500 });
  }

  const sigEntries: Array<{ signer: ContractSigner; signaturePng: Uint8Array }> = [];
  for (const s of signers as ContractSigner[]) {
    if (!s.signature_image_path) continue;
    const dl = await supabase.storage.from("contracts").download(s.signature_image_path);
    if (!dl.data) {
      return NextResponse.json(
        { error: `Missing stored signature for signer ${s.signer_order}` },
        { status: 500 },
      );
    }
    const buf = new Uint8Array(await dl.data.arrayBuffer());
    sigEntries.push({ signer: s, signaturePng: buf });
  }

  const companyMap = new Map<string, string | null>(
    (companyRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );

  const pdfBytes = await generateSignedPdf({
    contract,
    signatures: sigEntries,
    company: {
      name: companyMap.get("company_name") || "",
      phone: companyMap.get("phone") || "",
      email: companyMap.get("email") || "",
      address: companyMap.get("address") || "",
      license: companyMap.get("license") || "",
    },
  });

  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(contract.signed_pdf_path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `PDF upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, bytes: pdfBytes.length });
}
