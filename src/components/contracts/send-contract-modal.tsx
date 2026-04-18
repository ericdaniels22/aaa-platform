"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TiptapEditor from "@/components/tiptap-editor";
import PreviewContractModal from "./preview-contract-modal";
import { Loader2, Send, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import type { ContractTemplateListItem, ContractEmailSettings } from "@/lib/contracts/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  defaultSignerName: string | null;
  defaultSignerEmail: string | null;
  onSent: () => void | Promise<void>;
}

interface PreviewData {
  html: string;
  unresolvedFields: string[];
  templateVersion: number;
  defaultTitle: string;
}

export default function SendContractModal({
  open,
  onOpenChange,
  jobId,
  defaultSignerName,
  defaultSignerEmail,
  onSent,
}: Props) {
  const [templates, setTemplates] = useState<ContractTemplateListItem[] | null>(null);
  const [settings, setSettings] = useState<ContractEmailSettings | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [signerName, setSignerName] = useState<string>(defaultSignerName ?? "");
  const [signerEmail, setSignerEmail] = useState<string>(defaultSignerEmail ?? "");
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [sending, setSending] = useState(false);

  // Reset form whenever the modal reopens.
  useEffect(() => {
    if (!open) return;
    setSignerName(defaultSignerName ?? "");
    setSignerEmail(defaultSignerEmail ?? "");
    setPreview(null);
  }, [open, defaultSignerName, defaultSignerEmail]);

  const load = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      fetch("/api/settings/contract-templates"),
      fetch("/api/settings/contract-email"),
    ]);
    if (tRes.ok) {
      const data = (await tRes.json()) as ContractTemplateListItem[];
      const active = data.filter((t) => t.is_active);
      setTemplates(active);
      if (active.length && !templateId) setTemplateId(active[0].id);
    }
    if (sRes.ok) {
      const data = (await sRes.json()) as ContractEmailSettings;
      setSettings(data);
      setExpiryDays(data.default_link_expiry_days);
      setEmailSubject(data.signing_request_subject_template);
      setEmailBody(data.signing_request_body_template);
    }
  }, [templateId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const setupIncomplete = !!settings && (!settings.send_from_email || !settings.send_from_name);

  async function doPreview() {
    if (!templateId) return;
    setPreviewing(true);
    try {
      const res = await fetch("/api/contracts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data as PreviewData);
      setPreviewOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function doSend() {
    if (!templateId) {
      toast.error("Pick a template first");
      return;
    }
    if (!signerName.trim() || !signerEmail.trim()) {
      toast.error("Signer name and email are required");
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error("Email subject and body are required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/contracts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          templateId,
          signers: [{ name: signerName.trim(), email: signerEmail.trim() }],
          expiryDays,
          emailSubject,
          emailBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      toast.success("Contract sent for signature");
      await onSent();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send size={18} className="text-[var(--brand-primary)]" />
            Send for Signature
          </DialogTitle>
        </DialogHeader>

        {setupIncomplete && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            Contract email settings are incomplete — set a send-from address in Settings → Contracts first.
          </div>
        )}

        <div className="space-y-4">
          {/* Template */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Template</label>
            {templates === null ? (
              <div className="text-xs text-muted-foreground mt-1">
                <Loader2 size={12} className="inline animate-spin mr-1" /> Loading…
              </div>
            ) : templates.length === 0 ? (
              <div className="mt-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
                <FileText size={14} /> No active templates. Create one in Settings → Contract Templates first.
              </div>
            ) : (
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Signers */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">Signer</label>
              <button
                type="button"
                disabled
                title="Multi-signer lands in Build 15c"
                className="text-[11px] text-muted-foreground/60 inline-flex items-center gap-1 cursor-not-allowed"
              >
                <Plus size={11} /> Add signer
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Full name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              />
              <input
                type="email"
                placeholder="Email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              />
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Link expiration (days)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={expiryDays}
              onChange={(e) => setExpiryDays(Math.max(1, Math.min(30, Number(e.target.value))))}
              className="mt-1 w-28 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>

          {/* Email subject + body */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Email body</label>
            <div className="mt-1">
              <TiptapEditor
                content={emailBody}
                onChange={setEmailBody}
                placeholder="Email body shown to the signer"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {`{{signing_link}}`} and {`{{document_title}}`} resolve automatically when sent.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <button
            type="button"
            onClick={doPreview}
            disabled={!templateId || previewing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-foreground bg-muted/40 hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Preview Contract
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSend}
              disabled={sending || setupIncomplete || !templateId}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all disabled:opacity-60"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>

        <PreviewContractModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          preview={preview}
        />
      </DialogContent>
    </Dialog>
  );
}
