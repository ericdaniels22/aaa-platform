"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "signature_pad";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface SignerSlice {
  id: string;
  name: string;
  role_label: string | null;
  signer_order: number;
  signed_at: string | null;
}

interface Props {
  contractId: string;
  contractTitle: string;
  filledContentHtml: string;
  signers: SignerSlice[];
  initialActiveSignerId: string;
}

const ESIGN_CONSENT_TEXT =
  "I agree that my electronic signature is the legal equivalent of my manual signature on this document, and I consent to conduct business electronically under the U.S. ESIGN Act.";

// Tablet-optimized signing form for /contracts/[id]/sign-in-person.
// Dark theme matching the platform; larger signature pad, larger body
// type, larger tap targets than the remote /sign/[token] view. For
// multi-signer contracts this component stays mounted across signers —
// on submit we swap local state to the next signer without navigating.
export default function TabletSigningForm({
  contractId,
  contractTitle,
  filledContentHtml,
  signers,
  initialActiveSignerId,
}: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);

  const [activeSignerId, setActiveSignerId] = useState(initialActiveSignerId);
  const [signedIds, setSignedIds] = useState<Set<string>>(
    () => new Set(signers.filter((s) => s.signed_at).map((s) => s.id)),
  );
  const activeSigner = signers.find((s) => s.id === activeSignerId) ?? signers[0];

  const [hasSignature, setHasSignature] = useState(false);
  const [typedName, setTypedName] = useState(activeSigner.name);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx?.scale(ratio, ratio);
    pad.clear();
    setHasSignature(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, {
      backgroundColor: "rgba(0,0,0,0)",
      penColor: "#ffffff",
      minWidth: 1.0,
      maxWidth: 3.0,
    });
    pad.addEventListener("endStroke", () => setHasSignature(!pad.isEmpty()));
    padRef.current = pad;
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      pad.off();
    };
  }, [resizeCanvas]);

  function clearSignature() {
    padRef.current?.clear();
    setHasSignature(false);
  }

  function resetForNextSigner(nextSigner: SignerSlice) {
    setActiveSignerId(nextSigner.id);
    setTypedName(nextSigner.name);
    setConsent(false);
    setError(null);
    padRef.current?.clear();
    setHasSignature(false);
  }

  async function submit() {
    setError(null);
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setError("Please provide your signature before submitting.");
      return;
    }
    if (!typedName.trim()) {
      setError("Please type your full name.");
      return;
    }
    if (!consent) {
      setError("You must agree to the ESIGN consent to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const dataUrl = pad.toDataURL("image/png");
      const res = await fetch(`/api/contracts/${contractId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          in_person: true,
          signerId: activeSignerId,
          signatureDataUrl: dataUrl,
          typedName: typedName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Signing failed. Please try again.");
      }

      const justSignedId = activeSignerId;
      setSignedIds((prev) => {
        const next = new Set(prev);
        next.add(justSignedId);
        return next;
      });

      if (data.finalized) {
        router.push(`/contracts/${contractId}/sign-in-person/complete`);
        router.refresh();
        return;
      }

      if (data.nextSigner?.id) {
        const nextStub: SignerSlice = {
          id: data.nextSigner.id,
          name: data.nextSigner.name,
          role_label: data.nextSigner.role_label ?? null,
          signer_order: data.nextSigner.signer_order,
          signed_at: null,
        };
        toast.success(`Signer ${data.nextSigner.signer_order} — please hand to ${data.nextSigner.name}`);
        resetForNextSigner(nextStub);
      } else {
        // Defensive fallback — reload to pick up whatever the server did.
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setSubmitting(false);
    }
  }

  const totalSigners = signers.length;
  const activeIndex = signers.findIndex((s) => s.id === activeSignerId);
  const progressLabel =
    totalSigners > 1
      ? `Signer ${activeIndex + 1} of ${totalSigners}: ${activeSigner.role_label || activeSigner.name}`
      : null;

  return (
    <>
      {progressLabel && (
        <div className="flex items-center gap-3 mb-4">
          <ProgressDots
            total={totalSigners}
            activeIndex={activeIndex}
            signedIds={signedIds}
            signers={signers}
          />
          <div className="text-sm font-medium text-foreground">{progressLabel}</div>
        </div>
      )}

      {/* Document card — white card over the dark page background for readability */}
      <div className="rounded-2xl bg-white text-[#111827] shadow-2xl p-8 mb-5 max-h-[55vh] overflow-y-auto">
        <div
          className="tablet-doc-body"
          style={{ fontSize: 17, lineHeight: 1.8 }}
          dangerouslySetInnerHTML={{ __html: filledContentHtml }}
        />
      </div>

      {/* Signature section — dark card, larger pad */}
      <div className="rounded-2xl bg-card border border-border p-6 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {activeSigner.name}
              {activeSigner.role_label ? (
                <span className="ml-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {activeSigner.role_label}
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">{todayLabel}</div>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Sign below
          </div>
        </div>

        <div
          className="relative rounded-xl bg-background/40 border border-dashed border-border/70"
          style={{ height: 200 }}
        >
          <canvas ref={canvasRef} className="w-full h-full block touch-none" />
          <button
            type="button"
            onClick={clearSignature}
            className="absolute bottom-2 right-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Full name</label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <input
              type="text"
              value={todayLabel}
              readOnly
              className="mt-1 w-full rounded-lg border border-border bg-muted/40 px-3 py-3 text-base text-muted-foreground cursor-default"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 mt-5 cursor-pointer text-sm text-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 w-5 h-5"
            style={{ accentColor: "#0F6E56" }}
          />
          <span className="leading-relaxed">{ESIGN_CONSENT_TEXT}</span>
        </label>

        {error && (
          <div
            className="mt-4 px-3 py-2 text-sm rounded-lg"
            style={{
              backgroundColor: "rgba(228, 75, 74, 0.12)",
              color: "#F09595",
              border: "1px solid rgba(228, 75, 74, 0.3)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !consent || !hasSignature || !typedName.trim()}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-base font-semibold bg-[image:var(--gradient-primary)] text-white shadow-lg hover:brightness-110 transition-all disabled:opacity-50 min-w-[160px]"
        >
          {submitting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <CheckCircle2 size={18} />
          )}
          Sign
          {totalSigners > 1 && activeIndex < totalSigners - 1 ? (
            <ArrowRight size={16} />
          ) : null}
        </button>
      </div>
    </>
  );
}

function ProgressDots({
  total,
  activeIndex,
  signedIds,
  signers,
}: {
  total: number;
  activeIndex: number;
  signedIds: Set<string>;
  signers: SignerSlice[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const s = signers[i];
        const signed = signedIds.has(s.id);
        const active = i === activeIndex;
        return (
          <span
            key={s.id}
            className={
              signed
                ? "w-3 h-3 rounded-full bg-[#5DCAA5]"
                : active
                  ? "w-3 h-3 rounded-full bg-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30"
                  : "w-3 h-3 rounded-full bg-muted"
            }
          />
        );
      })}
    </div>
  );
}
