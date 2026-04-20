"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  showAch: boolean;
  showCard: boolean;
  cardFeeFormatted: string | null;
  passCardFee: boolean;
  thresholdApplied: boolean;
  feeDisclosure: string | null;
}

export default function MethodSelector({
  token,
  showAch,
  showCard,
  cardFeeFormatted,
  passCardFee,
  thresholdApplied,
  feeDisclosure,
}: Props) {
  const [loading, setLoading] = useState<"ach" | "card" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (method: "ach" | "card") => {
    setLoading(method);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const { error: e } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(e || "Failed to start checkout");
      }
      const { session_url } = (await res.json()) as { session_url: string };
      window.location.href = session_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(null);
    }
  };

  // Case 1: ACH only
  if (showAch && !showCard) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => go("ach")}
          className="public-button-primary w-full flex items-center justify-center gap-2"
        >
          {loading === "ach" && <Loader2 size={16} className="animate-spin" />}
          Pay by bank transfer
        </button>
        <div className="text-xs public-muted text-center">
          No additional fees
        </div>
        {thresholdApplied && (
          <div className="text-xs public-muted text-center">
            Bank transfer is required for payments of this size.
          </div>
        )}
        {error && <div className="text-xs text-red-600 text-center">{error}</div>}
      </div>
    );
  }

  // Case 3: Card only
  if (!showAch && showCard) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => go("card")}
          className="public-button-primary w-full flex items-center justify-center gap-2"
        >
          {loading === "card" && <Loader2 size={16} className="animate-spin" />}
          Pay by card
          {passCardFee && cardFeeFormatted && (
            <span className="ml-1 font-normal">
              (+ {cardFeeFormatted} service fee)
            </span>
          )}
        </button>
        {passCardFee && feeDisclosure && (
          <div className="text-xs public-muted">{feeDisclosure}</div>
        )}
        {error && <div className="text-xs text-red-600 text-center">{error}</div>}
      </div>
    );
  }

  // Case 2: both
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => go("ach")}
        className="public-button-primary w-full flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          {loading === "ach" && (
            <Loader2 size={16} className="animate-spin" />
          )}
          Pay by bank (no fee)
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "#ecfdf5", color: "#065f46" }}
        >
          No fee
        </span>
      </button>
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => go("card")}
        className="public-button-secondary w-full flex items-center justify-center gap-2"
      >
        {loading === "card" && <Loader2 size={16} className="animate-spin" />}
        Pay by card
        {passCardFee && cardFeeFormatted && (
          <span className="text-xs public-muted">
            + {cardFeeFormatted} service fee
          </span>
        )}
      </button>
      {passCardFee && feeDisclosure && (
        <div className="text-xs public-muted">{feeDisclosure}</div>
      )}
      {error && <div className="text-xs text-red-600 text-center">{error}</div>}
    </div>
  );
}
