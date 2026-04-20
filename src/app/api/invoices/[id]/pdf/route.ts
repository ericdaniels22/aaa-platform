// GET /api/invoices/[id]/pdf
// Query param `mode`: "download" (default) returns the file; "attachment" also
// uploads to Supabase storage under email-attachments/invoice-pdfs/{invoiceId}/{ts}.pdf
// and returns { storage_path, filename, content_type, file_size } — used by the
// Send Invoice flow to hand the file to the email composer.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { generateInvoicePdf } from "@/lib/invoices/generate-invoice-pdf";
import type { InvoiceWithItems } from "@/lib/invoices/types";

interface CompanySettingRow {
  key: string;
  value: string | null;
}

async function loadCompanyBlock(
  service: ReturnType<typeof createServiceClient>,
): Promise<{ name: string | null; address: string | null; phone: string | null; email: string | null }> {
  const { data } = await service.from("company_settings").select("key, value");
  const byKey = Object.fromEntries(
    ((data ?? []) as CompanySettingRow[]).map((r) => [r.key, r.value ?? ""]),
  );
  const addressParts = [
    byKey.address_street,
    [byKey.address_city, byKey.address_state, byKey.address_zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  return {
    name: byKey.company_name || null,
    address: addressParts.length ? addressParts.join(" · ") : null,
    phone: byKey.phone || null,
    email: byKey.email || null,
  };
}

async function loadPayload(
  service: ReturnType<typeof createServiceClient>,
  id: string,
): Promise<{
  invoice: InvoiceWithItems;
  company: { name: string | null; address: string | null; phone: string | null; email: string | null };
  customer: { name: string; address: string };
} | null> {
  const { data: invoice } = await service
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceWithItems>();
  if (!invoice) return null;
  const { data: items } = await service
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  invoice.line_items = items ?? [];

  const { data: job } = await service
    .from("jobs")
    .select("property_address, contact_id, contacts:contact_id(first_name, last_name)")
    .eq("id", invoice.job_id)
    .maybeSingle<{
      property_address: string | null;
      contact_id: string;
      contacts: { first_name: string | null; last_name: string | null } | null;
    }>();
  const customer = {
    name:
      [job?.contacts?.first_name, job?.contacts?.last_name].filter(Boolean).join(" ") || "Customer",
    address: job?.property_address ?? "",
  };

  const company = await loadCompanyBlock(service);
  return { invoice, company, customer };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const service = createServiceClient();
  const payload = await loadPayload(service, id);
  if (!payload) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buffer = await generateInvoicePdf(payload.invoice, payload.company, payload.customer);
  const filename = `invoice-${payload.invoice.invoice_number}.pdf`;

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  if (mode === "attachment") {
    const ts = Date.now();
    const path = `invoice-pdfs/${id}/${ts}.pdf`;
    const { error: upErr } = await service.storage
      .from("email-attachments")
      .upload(path, buffer, { contentType: "application/pdf", upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({
      storage_path: path,
      filename,
      content_type: "application/pdf",
      file_size: buffer.byteLength,
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
