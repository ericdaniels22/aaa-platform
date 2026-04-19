"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";

type Summary = {
  revenue: {
    current: number;
    prior: number;
    delta: { amount: number; pct: number | null; direction: "up" | "down" | "flat" } | null;
  };
  expenses: { current: number; pctOfRevenue: number | null };
  grossMargin: { amount: number; pct: number | null; crew_labor: number };
  outstandingAR: { amount: number; overSixty: number };
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function StatCards({ range }: { range: RangePreset }) {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/summary?range=${range}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [range]);

  if (!data) {
    return (
      <div className="grid grid-cols-4 gap-3">
        <CardSkel />
        <CardSkel />
        <CardSkel />
        <CardSkel />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      <Card label="Revenue" value={fmt(data.revenue.current)}>
        {data.revenue.delta && data.revenue.delta.pct !== null && (
          <div
            className="text-xs"
            style={{
              color:
                data.revenue.delta.direction === "up"
                  ? "#5DCAA5"
                  : data.revenue.delta.direction === "down"
                  ? "#F09595"
                  : "#a3a3a3",
            }}
          >
            {data.revenue.delta.direction === "up" ? "▲" : data.revenue.delta.direction === "down" ? "▼" : "–"}{" "}
            {Math.abs(data.revenue.delta.pct).toFixed(1)}% vs prior
          </div>
        )}
      </Card>
      <Card label="Expenses" value={fmt(data.expenses.current)}>
        {data.expenses.pctOfRevenue !== null && (
          <div className="text-xs text-muted-foreground">{data.expenses.pctOfRevenue.toFixed(1)}% of revenue</div>
        )}
      </Card>
      <Card
        label="Gross margin*"
        value={fmt(data.grossMargin.amount)}
        highlight
        title="Estimate — includes manual crew labor cost where entered"
      >
        {data.grossMargin.pct !== null && (
          <div className="text-xs" style={{ color: "#9FE1CB" }}>
            {data.grossMargin.pct.toFixed(1)}% margin
          </div>
        )}
      </Card>
      <Card label="Outstanding AR" value={fmt(data.outstandingAR.amount)}>
        {data.outstandingAR.overSixty > 0 && (
          <div className="text-xs" style={{ color: "#FAC775" }}>
            {fmt(data.outstandingAR.overSixty)} over 60 days
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  label,
  value,
  children,
  highlight,
  title,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  highlight?: boolean;
  title?: string;
}) {
  const hl = highlight
    ? { background: "rgba(29, 158, 117, 0.12)", border: "1px solid rgba(29, 158, 117, 0.35)" }
    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" };
  return (
    <div className="rounded-lg p-4" style={hl} title={title}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={highlight ? { color: "#5DCAA5" } : undefined}>
        {value}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CardSkel() {
  return (
    <div
      className="rounded-lg p-4 animate-pulse"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="h-4 w-16 rounded bg-muted" />
      <div className="mt-2 h-7 w-24 rounded bg-muted" />
    </div>
  );
}
