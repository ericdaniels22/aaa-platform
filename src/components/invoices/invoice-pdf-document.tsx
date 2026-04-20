// Plain, printable invoice PDF. Matches the report-pdf structure (Build 11).
// No design polish — line items, totals, company header, payment info.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceWithItems } from "@/lib/invoices/types";

interface CompanyBlock {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface CustomerBlock {
  name: string;
  address: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  companyName: { fontSize: 14, fontWeight: "bold" },
  muted: { color: "#666", fontSize: 9 },
  title: { fontSize: 22, fontWeight: "bold", textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 4 },
  metaLabel: { color: "#666" },
  section: { marginTop: 16 },
  h: { fontWeight: "bold", fontSize: 10, marginBottom: 4 },
  table: { marginTop: 8, borderTop: "1 solid #ddd" },
  tr: { flexDirection: "row", borderBottom: "1 solid #eee", paddingVertical: 6 },
  thRow: { flexDirection: "row", paddingVertical: 6, backgroundColor: "#f5f5f5" },
  tdDesc: { flex: 3, paddingHorizontal: 6 },
  tdQty: { flex: 0.6, paddingHorizontal: 6, textAlign: "right" },
  tdPrice: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
  tdAmt: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalBold: { fontWeight: "bold", borderTop: "1 solid #333", paddingTop: 4, marginTop: 4 },
  memo: { marginTop: 20, paddingTop: 12, borderTop: "1 solid #eee" },
});

function money(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function InvoicePdfDocument({
  invoice,
  company,
  customer,
}: {
  invoice: InvoiceWithItems;
  company: CompanyBlock;
  customer: CustomerBlock;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name ?? "Company"}</Text>
            {company.address && <Text style={styles.muted}>{company.address}</Text>}
            {company.phone && <Text style={styles.muted}>{company.phone}</Text>}
            {company.email && <Text style={styles.muted}>{company.email}</Text>}
          </View>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{invoice.invoice_number}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issued</Text>
              <Text>{fmtDate(invoice.issued_date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Due</Text>
              <Text>{fmtDate(invoice.due_date)}</Text>
            </View>
            {invoice.po_number && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>PO</Text>
                <Text>{invoice.po_number}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Bill to</Text>
          <Text>{customer.name}</Text>
          <Text style={styles.muted}>{customer.address}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={styles.tdDesc}>Description</Text>
            <Text style={styles.tdQty}>Qty</Text>
            <Text style={styles.tdPrice}>Unit price</Text>
            <Text style={styles.tdAmt}>Amount</Text>
          </View>
          {invoice.line_items.map((li) => (
            <View key={li.id} style={styles.tr}>
              <Text style={styles.tdDesc}>
                {li.xactimate_code ? `[${li.xactimate_code}] ` : ""}
                {li.description}
              </Text>
              <Text style={styles.tdQty}>{Number(li.quantity)}</Text>
              <Text style={styles.tdPrice}>{money(Number(li.unit_price))}</Text>
              <Text style={styles.tdAmt}>{money(Number(li.amount))}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{money(Number(invoice.subtotal))}</Text>
          </View>
          {Number(invoice.tax_amount) > 0 && (
            <View style={styles.totalsRow}>
              <Text>Tax ({(Number(invoice.tax_rate) * 100).toFixed(2)}%)</Text>
              <Text>{money(Number(invoice.tax_amount))}</Text>
            </View>
          )}
          <View style={[styles.totalsRow, styles.totalBold]}>
            <Text>Total</Text>
            <Text>{money(Number(invoice.total_amount))}</Text>
          </View>
        </View>

        {invoice.memo && (
          <View style={styles.memo}>
            <Text style={styles.h}>Memo</Text>
            <Text>{invoice.memo}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
