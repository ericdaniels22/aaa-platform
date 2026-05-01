"use client";

import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { Input } from "@/components/ui/input";
import type { AdjustmentType, Estimate } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface TotalsPanelProps {
  estimate: Estimate;
  onMarkupChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AdjustmentToggle — 3-button group for % / $ / none
// ─────────────────────────────────────────────────────────────────────────────

function AdjustmentToggle({
  type,
  value,
  onChange,
  disabled,
}: {
  type: AdjustmentType;
  value: number;
  onChange: (type: AdjustmentType, value: number) => void;
  disabled: boolean;
}) {
  const btn =
    "px-1.5 py-0.5 rounded text-xs font-medium transition-colors leading-tight";
  const active = "bg-primary text-primary-foreground";
  const inactive = "text-muted-foreground hover:text-foreground hover:bg-muted";

  return (
    <div className="flex gap-0.5 rounded border border-border p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("percent", value)}
        className={`${btn} ${type === "percent" ? active : inactive}`}
        title="Percent"
      >
        %
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("amount", value)}
        className={`${btn} ${type === "amount" ? active : inactive}`}
        title="Fixed amount"
      >
        $
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("none", 0)}
        className={`${btn} ${type === "none" ? active : inactive}`}
        title="None"
      >
        —
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdjustmentRow — toggle + value input + computed display
// ─────────────────────────────────────────────────────────────────────────────

function AdjustmentRow({
  label,
  type,
  value,
  amount,
  onChange,
  readOnly,
  isDiscount,
}: {
  label: string;
  type: AdjustmentType;
  value: number;
  amount: number;
  onChange: (type: AdjustmentType, value: number) => void;
  readOnly: boolean;
  isDiscount?: boolean;
}) {
  const isNone = type === "none";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-foreground">
          {isNone
            ? "—"
            : isDiscount
            ? `−${formatCurrency(amount)}`
            : formatCurrency(amount)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <AdjustmentToggle
          type={type}
          value={value}
          onChange={onChange}
          disabled={readOnly}
        />
        <Input
          type="number"
          min={0}
          step={0.01}
          value={isNone ? "" : value}
          disabled={readOnly || isNone}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n) && n >= 0) onChange(type, n);
          }}
          className="h-6 text-xs px-1.5 flex-1 min-w-0"
          placeholder={isNone ? "—" : type === "percent" ? "0" : "0.00"}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TotalsPanel
// ─────────────────────────────────────────────────────────────────────────────

export function TotalsPanel({
  estimate,
  onMarkupChange,
  onDiscountChange,
  onTaxRateChange,
  readOnly = false,
}: TotalsPanelProps) {
  const isNegative = estimate.total < 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-10 w-72 rounded-lg border border-border bg-card p-4 shadow-lg"
      aria-label="Estimate totals"
    >
      <div className="space-y-2 text-sm">

        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Subtotal</span>
          <span className="text-xs font-mono">{formatCurrency(estimate.subtotal)}</span>
        </div>

        {/* Markup */}
        <AdjustmentRow
          label="Markup"
          type={estimate.markup_type}
          value={estimate.markup_value}
          amount={estimate.markup_amount}
          onChange={onMarkupChange}
          readOnly={readOnly}
        />

        {/* Discount */}
        <AdjustmentRow
          label="Discount"
          type={estimate.discount_type}
          value={estimate.discount_value}
          amount={estimate.discount_amount}
          onChange={onDiscountChange}
          readOnly={readOnly}
          isDiscount
        />

        {/* Adjusted subtotal */}
        <div className="flex items-center justify-between border-t border-border pt-1.5">
          <span className="text-xs text-muted-foreground">Adjusted subtotal</span>
          <span className="text-xs font-mono">{formatCurrency(estimate.adjusted_subtotal)}</span>
        </div>

        {/* Tax */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground">Tax</span>
            <span className="text-xs font-mono">{formatCurrency(estimate.tax_amount)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={estimate.tax_rate}
              disabled={readOnly}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) onTaxRateChange(n);
              }}
              className="h-6 text-xs px-1.5 w-16 flex-none"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        {/* Total */}
        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
          <span className="font-semibold text-sm text-foreground">Total</span>
          <span
            className={`font-bold text-base font-mono ${
              isNegative ? "text-destructive" : "text-foreground"
            }`}
          >
            {formatCurrency(estimate.total)}
          </span>
        </div>

        {/* Negative total warning */}
        {isNegative && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle size={12} className="text-destructive" />
            <span>Negative total</span>
          </div>
        )}
      </div>
    </div>
  );
}
