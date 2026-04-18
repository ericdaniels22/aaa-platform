"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Loader2, CheckCircle2 } from "lucide-react";

interface ContractSlice {
  id: string;
  title: string;
  filled_content_html: string;
}

interface SignerSlice {
  id: string;
  name: string;
  role_label: string | null;
}

interface Props {
  contract: ContractSlice;
  signer: SignerSlice;
  token: string;
}

const ESIGN_CONSENT_TEXT =
  "I agree that my electronic signature is the legal equivalent of my manual signature on this document, and I consent to conduct business electronically under the U.S. ESIGN Act.";

export default function SigningForm({ contract, signer, token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [typedName, setTypedName] = useState(signer.name);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Size canvas to its container, preserving the DPR for crisp strokes.
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
      penColor: "#111827",
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
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          signatureDataUrl: dataUrl,
          typedName: typedName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Signing failed. Please try again.");
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="public-card p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3" size={42} color="#0f6e56" />
        <h2 className="text-xl font-semibold mb-2" style={{ color: "#111827" }}>
          Thanks for signing
        </h2>
        <p className="text-sm public-muted mb-4">
          {contract.title} has been signed. A copy with an audit trail has been sent to the email on file.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Title block */}
      <div className="public-card p-5 mb-4">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "#111827" }}>
          {contract.title}
        </h1>
        <p className="text-xs public-muted">
          Signer: {signer.name}
          {signer.role_label ? ` (${signer.role_label})` : ""} · {todayLabel}
        </p>
      </div>

      {/* Document */}
      <div className="public-card p-5 mb-4">
        <div
          className="public-doc-body"
          style={{ maxHeight: 360, overflowY: "auto" }}
          dangerouslySetInnerHTML={{ __html: contract.filled_content_html }}
        />
      </div>

      {/* Signature section */}
      <div className="public-card p-5 mb-4">
        <label className="text-xs font-medium public-muted">Your signature</label>
        <div className={`signing-pad relative mt-1 ${hasSignature ? "has-signature" : ""}`} style={{ height: 140 }}>
          <canvas ref={canvasRef} className="w-full h-full block" />
          <button
            type="button"
            onClick={clearSignature}
            className="absolute bottom-2 right-3 text-xs public-muted hover:text-gray-800"
          >
            Clear
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="text-xs font-medium public-muted">Your full name</label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                color: "#111827",
              }}
            />
          </div>
          <div>
            <label className="text-xs font-medium public-muted">Date</label>
            <input
              type="text"
              value={todayLabel}
              readOnly
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{
                border: "1px solid #d1d5db",
                backgroundColor: "#f9fafb",
                color: "#6b7280",
              }}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 mt-4 cursor-pointer text-sm" style={{ color: "#1a1a1a" }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
            style={{ accentColor: "#0f6e56" }}
          />
          <span>{ESIGN_CONSENT_TEXT}</span>
        </label>

        {error && (
          <div
            className="mt-3 px-3 py-2 text-sm rounded-lg"
            style={{ backgroundColor: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mb-2">
        <button
          type="button"
          className="public-button-secondary"
          onClick={() => window.close()}
        >
          Save &amp; finish later
        </button>
        <button
          type="button"
          className="public-button-primary inline-flex items-center justify-center gap-2"
          onClick={submit}
          disabled={submitting || !consent || !hasSignature || !typedName.trim()}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
          Sign &amp; Submit
        </button>
      </div>
    </>
  );
}
