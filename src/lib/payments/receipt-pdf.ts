import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsd } from "./merge-fields";

// Branded receipt PDF generator (Build 17c, Task 8).
//
// Schema notes that shape this file:
//   - company_settings is a key/value store (migration-build14a). Branding is
//     read by `key in ('company_name','phone','email','address','license','logo_path')`.
//     There are no separate city/state/zip columns and no `license_number` key;
//     the admin-entered `address` text is already a full multi-line string,
//     and the license key is `license` (not `license_number`).
//   - Logos are stored in the `company-assets` Storage bucket under the path
//     saved as the `logo_path` value. See src/app/api/settings/company/logo/route.ts.
//   - jobs.property_address is a single text column. jobs has no separate
//     street_address / city / state / zip columns.
//   - invoices has invoice_number and total_amount.
//
// The caller (Task 9 webhook handler) uploads the returned Buffer to Storage
// and attaches it to the customer receipt email.

interface CompanyBranding {
  company_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  license: string | null;
  logo_path: string | null;
}

interface PaymentRequestForReceipt {
  id: string;
  job_id: string;
  invoice_id: string | null;
  title: string;
  amount: number;
  card_fee_amount: number | null;
  total_charged: number | null;
  paid_at: string | null;
  stripe_receipt_url: string | null;
  payer_name: string | null;
  payer_email: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
}

interface JobForReceipt {
  job_number: string | null;
  property_address: string | null;
}

interface InvoiceForReceipt {
  invoice_number: string | null;
  total_amount: number;
}

interface CompanySettingRow {
  key: string;
  value: string | null;
}

export interface GenerateReceiptPdfInput {
  paymentRequestId: string;
  methodDisplay: string;
  transactionIdDisplay: string;
  stripeFeeAmount: number | null;
  netAmount: number | null;
}

const BRANDING_KEYS = [
  "company_name",
  "phone",
  "email",
  "address",
  "license",
  "logo_path",
] as const;

async function loadCompanyBranding(
  supabase: SupabaseClient,
): Promise<CompanyBranding> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", BRANDING_KEYS as unknown as string[]);
  if (error) throw new Error(`company_settings load: ${error.message}`);
  const map = new Map<string, string | null>(
    (data ?? []).map((r: CompanySettingRow) => [r.key, r.value]),
  );
  return {
    company_name: map.get("company_name") ?? null,
    address: map.get("address") ?? null,
    phone: map.get("phone") ?? null,
    email: map.get("email") ?? null,
    license: map.get("license") ?? null,
    logo_path: map.get("logo_path") ?? null,
  };
}

async function loadReceiptContext(
  supabase: SupabaseClient,
  paymentRequestId: string,
): Promise<{
  pr: PaymentRequestForReceipt;
  job: JobForReceipt;
  invoice: InvoiceForReceipt | null;
}> {
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select(
      "id, job_id, invoice_id, title, amount, card_fee_amount, total_charged, paid_at, stripe_receipt_url, payer_name, payer_email, payment_method_type",
    )
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestForReceipt>();
  if (prErr || !pr)
    throw new Error(
      `payment_request ${paymentRequestId} not found: ${prErr?.message ?? ""}`,
    );

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("job_number, property_address")
    .eq("id", pr.job_id)
    .maybeSingle<JobForReceipt>();
  if (jobErr || !job) throw new Error(`job ${pr.job_id} not found`);

  let invoice: InvoiceForReceipt | null = null;
  if (pr.invoice_id) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("invoice_number, total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<InvoiceForReceipt>();
    invoice = inv ?? null;
  }

  return { pr, job, invoice };
}

async function loadLogoBytes(
  supabase: SupabaseClient,
  path: string | null,
): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("company-assets")
    .download(path);
  if (!data) return null;
  const arrayBuf = await data.arrayBuffer();
  return new Uint8Array(arrayBuf);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// StandardFonts.Helvetica is WinAnsi-encoded. Non-Latin characters throw
// at drawText time. Replace anything outside WinAnsi with "?" so the
// receipt renders even when a payer name contains e.g. CJK or emoji.
function winAnsiSafe(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[^\x00-\xff]/g, "?");
}

export async function generateReceiptPdf(
  supabase: SupabaseClient,
  input: GenerateReceiptPdfInput,
): Promise<Buffer> {
  const [{ pr, job, invoice }, company] = await Promise.all([
    loadReceiptContext(supabase, input.paymentRequestId),
    loadCompanyBranding(supabase),
  ]);

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 48;
  let cursorY = height - marginX;
  const textColor = rgb(0.12, 0.12, 0.14);
  const mutedColor = rgb(0.45, 0.45, 0.5);
  const accentColor = rgb(0.11, 0.62, 0.46);

  const logoBytes = await loadLogoBytes(supabase, company.logo_path).catch(
    () => null,
  );
  let logoHeight = 0;
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng =
        logoBytes[0] === 0x89 &&
        logoBytes[1] === 0x50 &&
        logoBytes[2] === 0x4e;
      const img = isPng
        ? await doc.embedPng(logoBytes)
        : await doc.embedJpg(logoBytes);
      const scale = Math.min(1, 90 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: marginX,
        y: cursorY - h,
        width: w,
        height: h,
      });
      logoHeight = h;
    } catch {
      logoHeight = 0;
    }
  }

  const receiptNumber = winAnsiSafe(`#${pr.id.slice(0, 8).toUpperCase()}`);
  page.drawText("RECEIPT", {
    x: width - marginX - bold.widthOfTextAtSize("RECEIPT", 24),
    y: cursorY - 18,
    size: 24,
    font: bold,
    color: accentColor,
  });
  page.drawText(receiptNumber, {
    x: width - marginX - font.widthOfTextAtSize(receiptNumber, 10),
    y: cursorY - 36,
    size: 10,
    font,
    color: mutedColor,
  });
  const dateStr = winAnsiSafe(formatDate(pr.paid_at));
  page.drawText(dateStr, {
    x: width - marginX - font.widthOfTextAtSize(dateStr, 10),
    y: cursorY - 50,
    size: 10,
    font,
    color: mutedColor,
  });

  cursorY -= Math.max(logoHeight, 70) + 24;

  // company.address is a single multi-line text blob; split on newlines so
  // each address line renders on its own row.
  const addressLines = (company.address ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const companyLines = [
    company.company_name || "",
    ...addressLines,
    [company.phone, company.email].filter(Boolean).join(" • "),
    company.license ? `License: ${company.license}` : "",
  ].filter(Boolean);
  for (const line of companyLines.map(winAnsiSafe)) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: textColor,
    });
    cursorY -= 14;
  }
  cursorY -= 18;

  page.drawText("PAID BY", {
    x: marginX,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  cursorY -= 14;
  const paidByLines = [
    pr.payer_name || "—",
    pr.payer_email || "",
    `Job: ${job.job_number ?? "—"} — ${pr.title}`,
    job.property_address ?? "",
  ].filter(Boolean);
  for (const line of paidByLines.map(winAnsiSafe)) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: textColor,
    });
    cursorY -= 14;
  }
  cursorY -= 20;

  const tableTopY = cursorY;
  page.drawLine({
    start: { x: marginX, y: tableTopY },
    end: { x: width - marginX, y: tableTopY },
    thickness: 0.5,
    color: mutedColor,
  });
  cursorY -= 16;
  page.drawText("Description", {
    x: marginX,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  page.drawText("Amount", {
    x: width - marginX - 80,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  cursorY -= 18;

  const baseAmount = Number(pr.amount);
  const feeAmount = pr.card_fee_amount != null ? Number(pr.card_fee_amount) : 0;
  const totalPaid =
    pr.total_charged != null ? Number(pr.total_charged) : baseAmount;

  page.drawText(winAnsiSafe(pr.title), {
    x: marginX,
    y: cursorY,
    size: 11,
    font,
    color: textColor,
  });
  page.drawText(winAnsiSafe(formatUsd(baseAmount) ?? ""), {
    x: width - marginX - 80,
    y: cursorY,
    size: 11,
    font,
    color: textColor,
  });
  cursorY -= 18;

  if (feeAmount > 0) {
    page.drawText("Card processing fee", {
      x: marginX,
      y: cursorY,
      size: 11,
      font,
      color: textColor,
    });
    page.drawText(winAnsiSafe(formatUsd(feeAmount) ?? ""), {
      x: width - marginX - 80,
      y: cursorY,
      size: 11,
      font,
      color: textColor,
    });
    cursorY -= 18;
  }

  page.drawLine({
    start: { x: marginX, y: cursorY + 4 },
    end: { x: width - marginX, y: cursorY + 4 },
    thickness: 0.5,
    color: mutedColor,
  });
  cursorY -= 18;

  page.drawText("TOTAL PAID", {
    x: marginX,
    y: cursorY,
    size: 13,
    font: bold,
    color: textColor,
  });
  page.drawText(winAnsiSafe(formatUsd(totalPaid) ?? ""), {
    x: width - marginX - 80,
    y: cursorY,
    size: 13,
    font: bold,
    color: accentColor,
  });
  cursorY -= 30;

  const metaLines = [
    `Method: ${input.methodDisplay}`,
    `Transaction ID: ${input.transactionIdDisplay}`,
  ];
  if (input.stripeFeeAmount != null) {
    metaLines.push(
      `Processing fee: ${formatUsd(input.stripeFeeAmount)} (deducted by Stripe)`,
    );
  }
  if (input.netAmount != null) {
    metaLines.push(`Net deposited to bank: ${formatUsd(input.netAmount)}`);
  }
  for (const line of metaLines.map(winAnsiSafe)) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: mutedColor,
    });
    cursorY -= 14;
  }

  if (invoice) {
    cursorY -= 14;
    page.drawText(
      winAnsiSafe(
        `Applied to invoice ${invoice.invoice_number ?? ""} (${formatUsd(
          Number(invoice.total_amount),
        )}).`,
      ),
      {
        x: marginX,
        y: cursorY,
        size: 10,
        font,
        color: mutedColor,
      },
    );
    cursorY -= 14;
  }

  const footerY = 60;
  page.drawLine({
    start: { x: marginX, y: footerY + 40 },
    end: { x: width - marginX, y: footerY + 40 },
    thickness: 0.5,
    color: mutedColor,
  });
  page.drawText("Thank you for your business.", {
    x: marginX,
    y: footerY + 20,
    size: 10,
    font: bold,
    color: textColor,
  });
  if (pr.stripe_receipt_url) {
    page.drawText(
      winAnsiSafe(
        `A Stripe-issued receipt is also available at ${pr.stripe_receipt_url}`,
      ),
      {
        x: marginX,
        y: footerY + 4,
        size: 8,
        font,
        color: mutedColor,
      },
    );
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
