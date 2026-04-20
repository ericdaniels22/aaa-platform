// Renders the invoice PDF document to a Buffer. Called by the /pdf route handler.

import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdfDocument } from "@/components/invoices/invoice-pdf-document";
import type { InvoiceWithItems } from "@/lib/invoices/types";

export interface PdfCompany {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface PdfCustomer {
  name: string;
  address: string;
}

export async function generateInvoicePdf(
  invoice: InvoiceWithItems,
  company: PdfCompany,
  customer: PdfCustomer,
): Promise<Buffer> {
  return renderToBuffer(
    <InvoicePdfDocument invoice={invoice} company={company} customer={customer} />,
  );
}
