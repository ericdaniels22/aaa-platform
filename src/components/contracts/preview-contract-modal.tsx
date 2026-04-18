"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, AlertTriangle } from "lucide-react";

interface PreviewData {
  html: string;
  unresolvedFields: string[];
  templateVersion: number;
  defaultTitle: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preview: PreviewData | null;
}

export default function PreviewContractModal({ open, onOpenChange, preview }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} className="text-[var(--brand-primary)]" />
            {preview?.defaultTitle || "Preview"}
          </DialogTitle>
        </DialogHeader>

        {preview?.unresolvedFields?.length ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              The following merge fields have no source data on this job and will render as blank lines:{" "}
              <span className="font-mono">{preview.unresolvedFields.join(", ")}</span>
            </div>
          </div>
        ) : null}

        <div
          className="contract-template-prose prose prose-sm dark:prose-invert max-w-none border border-border rounded-lg p-5 bg-background/40"
          dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }}
        />
      </DialogContent>
    </Dialog>
  );
}
