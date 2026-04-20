"use client";

import { computeTotals, type InvoiceLineItemInput } from "@/lib/invoices/types";

export default function InvoiceTotalsPanel({
  items,
  taxRate,
  onTaxRateChange,
  readOnly = false,
}: {
  items: InvoiceLineItemInput[];
  taxRate: number; // decimal
  onTaxRateChange: (decimal: number) => void;
  readOnly?: boolean;
}) {
  const { subtotal, taxAmount, total } = computeTotals(items, taxRate);
  const percent = (taxRate * 100).toFixed(2);

  return (
    <div className="bg-card border border-border rounded-xl p-4 w-full md:w-80 md:ml-auto space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span>${subtotal.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Tax rate</span>
        <div className="flex items-center gap-1">
          <input
            disabled={readOnly}
            type="number"
            min="0"
            max="30"
            step="0.01"
            value={percent}
            onChange={(e) => onTaxRateChange(Math.max(0, Number(e.target.value)) / 100)}
            className="w-20 border border-border rounded-md px-2 py-1 bg-background text-right disabled:opacity-70"
          />
          <span className="text-muted-foreground">%</span>
        </div>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Tax</span>
        <span>${taxAmount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between pt-2 border-t border-border font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
