"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { InvoiceLineItemInput } from "@/lib/invoices";

export interface EditableLineItem extends InvoiceLineItemInput {
  key: string; // client-only; stable React key across reorders
}

function makeKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function blankLine(): EditableLineItem {
  return { key: makeKey(), description: "", quantity: 1, unit_price: 0, xactimate_code: null };
}

export function toInputs(items: EditableLineItem[]): InvoiceLineItemInput[] {
  return items.map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unit_price: Number(li.unit_price),
    xactimate_code: li.xactimate_code ?? null,
  }));
}

export default function LineItemsEditor({
  items,
  onChange,
  readOnly = false,
}: {
  items: EditableLineItem[];
  onChange: (next: EditableLineItem[]) => void;
  readOnly?: boolean;
}) {
  function update(idx: number, patch: Partial<EditableLineItem>) {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...items, blankLine()]);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-8"></th>
            <th className="text-left px-3 py-2 font-medium">Description</th>
            <th className="text-left px-3 py-2 font-medium w-28">Xactimate</th>
            <th className="text-right px-3 py-2 font-medium w-20">Qty</th>
            <th className="text-right px-3 py-2 font-medium w-28">Unit price</th>
            <th className="text-right px-3 py-2 font-medium w-28">Amount</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => {
            const amount = Number(li.quantity) * Number(li.unit_price);
            return (
              <tr key={li.key} className="border-t border-border">
                <td className="px-2 py-2 text-muted-foreground">
                  {!readOnly && (
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => move(idx, idx - 1)}
                        className="text-xs hover:text-foreground"
                        aria-label="Move up"
                      >▲</button>
                      <GripVertical size={12} />
                      <button
                        onClick={() => move(idx, idx + 1)}
                        className="text-xs hover:text-foreground"
                        aria-label="Move down"
                      >▼</button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <textarea
                    disabled={readOnly}
                    value={li.description}
                    onChange={(e) => update(idx, { description: e.target.value })}
                    rows={2}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-sm resize-none disabled:opacity-70"
                    placeholder="Description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    value={li.xactimate_code ?? ""}
                    onChange={(e) => update(idx, { xactimate_code: e.target.value || null })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70"
                    placeholder="DRY-1/RT+"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    min="0"
                    step="0.01"
                    value={li.quantity}
                    onChange={(e) => update(idx, { quantity: Number(e.target.value) })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-right text-sm disabled:opacity-70"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    min="0"
                    step="0.01"
                    value={li.unit_price}
                    onChange={(e) => update(idx, { unit_price: Number(e.target.value) })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-right text-sm disabled:opacity-70"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  ${amount.toFixed(2)}
                </td>
                <td className="px-2 py-2">
                  {!readOnly && (
                    <button
                      onClick={() => remove(idx)}
                      className="text-muted-foreground hover:text-red-500"
                      aria-label="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="p-3 border-t border-border">
          <button
            onClick={add}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={14} /> Add line
          </button>
        </div>
      )}
    </div>
  );
}
