"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface JobOption {
  id: string;
  label: string;
}

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  contentHtml: string;
}

interface PreviewResponse {
  html: string;
  unresolvedFields: string[];
}

export default function PreviewModal({ open, onClose, contentHtml }: PreviewModalProps) {
  const [jobs, setJobs] = useState<JobOption[] | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Fetch job list once when modal opens.
  useEffect(() => {
    if (!open || jobs !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/contract-templates/jobs");
        if (!res.ok) throw new Error("Failed to load jobs");
        const data = (await res.json()) as JobOption[];
        if (cancelled) return;
        setJobs(data);
        if (data.length > 0) setSelectedJobId(data[0].id);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load jobs");
          setJobs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobs]);

  // Fetch resolved preview whenever the selection or content changes.
  useEffect(() => {
    if (!open || !selectedJobId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    (async () => {
      try {
        const res = await fetch("/api/settings/contract-templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: selectedJobId, contentHtml }),
        });
        if (!res.ok) throw new Error("Preview failed");
        const data = (await res.json()) as PreviewResponse;
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Preview failed");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedJobId, contentHtml]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Template Preview</h2>
            <p className="text-xs text-muted-foreground">
              Merge fields resolved using data from the selected job.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <label className="text-xs font-medium text-muted-foreground">Preview with job:</label>
          {jobs === null ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Loading jobs…
            </span>
          ) : jobs.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No jobs available — create a job first to preview real data.
            </span>
          ) : (
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          )}
          {loadingPreview && (
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-6 bg-background/40">
          {preview ? (
            <>
              {preview.unresolvedFields.length > 0 && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">
                      {preview.unresolvedFields.length} unresolved field
                      {preview.unresolvedFields.length === 1 ? "" : "s"}:
                    </span>{" "}
                    <span className="font-mono">{preview.unresolvedFields.join(", ")}</span>
                    <div className="text-amber-200/80 mt-0.5">
                      These show as blank lines in the contract until the underlying job data is populated.
                    </div>
                  </div>
                </div>
              )}
              <article
                className="contract-template-prose prose prose-sm dark:prose-invert max-w-none text-foreground"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            </>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-20">
              {jobs === null ? "Loading preview…" : "Select a job to see the rendered template."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
