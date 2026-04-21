// Shared invoice types used by API routes + UI.

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  xactimate_code?: string | null;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  xactimate_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  organization_id: string;
  invoice_number: string;
  job_id: string;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  po_number: string | null;
  memo: string | null;
  notes: string | null;
  sent_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  qb_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithItems extends InvoiceRow {
  line_items: InvoiceLineItemRow[];
}

export interface CreateInvoiceInput {
  jobId: string;
  issuedDate?: string; // ISO; defaults to now server-side
  dueDate?: string | null;
  lineItems: InvoiceLineItemInput[];
  taxRate?: number; // decimal; 0.0875 = 8.75%
  poNumber?: string | null;
  memo?: string | null;
  notes?: string | null;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTotals(
  items: InvoiceLineItemInput[],
  taxRate: number,
): { subtotal: number; taxAmount: number; total: number; lineAmounts: number[] } {
  const lineAmounts = items.map((li) => roundMoney(Number(li.quantity) * Number(li.unit_price)));
  const subtotal = roundMoney(lineAmounts.reduce((a, b) => a + b, 0));
  const taxAmount = roundMoney(subtotal * Number(taxRate || 0));
  const total = roundMoney(subtotal + taxAmount);
  return { subtotal, taxAmount, total, lineAmounts };
}
