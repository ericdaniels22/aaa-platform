"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Save, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import TemplateEditor, { type TemplateEditorHandle } from "@/components/contracts/template-editor";
import MergeFieldSidebar from "@/components/contracts/merge-field-sidebar";
import PreviewModal from "@/components/contracts/preview-modal";
import type { ContractTemplate } from "@/lib/contracts/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ContractTemplateEditPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed = hasPermission("manage_contract_templates");

  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Editable metadata + settings mirror DB state; edits go through local
  // state until Save flushes them.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultSignerCount, setDefaultSignerCount] = useState<1 | 2>(1);
  const [signerRoleLabel, setSignerRoleLabel] = useState("Homeowner");
  const [isActive, setIsActive] = useState(true);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const editorHandleRef = useRef<TemplateEditorHandle | null>(null);
  const handleEditorReady = useCallback((h: TemplateEditorHandle) => {
    editorHandleRef.current = h;
  }, []);

  useEffect(() => {
    if (!authLoading && allowed) {
      (async () => {
        const res = await fetch(`/api/settings/contract-templates/${id}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          toast.error("Failed to load template");
          return;
        }
        const data = (await res.json()) as ContractTemplate;
        setTemplate(data);
        setName(data.name ?? "");
        setDescription(data.description ?? "");
        setDefaultSignerCount(data.default_signer_count ?? 1);
        setSignerRoleLabel(data.signer_role_label ?? "Homeowner");
        setIsActive(data.is_active ?? true);
      })();
    }
  }, [authLoading, allowed, id]);

  async function handleSave() {
    if (!editorHandleRef.current) return;
    setSaving(true);
    try {
      const content = editorHandleRef.current.getJSON();
      const contentHtml = editorHandleRef.current.getHTML();
      const res = await fetch(`/api/settings/contract-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Untitled Template",
          description: description.trim() || null,
          default_signer_count: defaultSignerCount,
          signer_role_label: signerRoleLabel.trim() || "Homeowner",
          is_active: isActive,
          content,
          content_html: contentHtml,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = (await res.json()) as ContractTemplate;
      setTemplate(updated);
      setDirty(false);
      toast.success(`Saved — version ${updated.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function openPreview() {
    if (!editorHandleRef.current) {
      toast.error("Editor not ready");
      return;
    }
    setPreviewOpen(true);
  }

  // Warn on unload with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  if (authLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Lock size={28} className="mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You don&apos;t have permission to edit contract templates.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">Template not found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This template may have been deleted.
        </p>
        <Link
          href="/settings/contract-templates"
          className="inline-flex items-center gap-1 mt-4 text-sm text-[var(--brand-primary)] hover:underline"
        >
          <ArrowLeft size={14} /> Back to templates
        </Link>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading template…
      </div>
    );
  }

  const currentHtml = editorHandleRef.current?.getHTML() ?? template.content_html;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              if (dirty && !confirm("Discard unsaved changes?")) return;
              router.push("/settings/contract-templates");
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            aria-label="Back to templates"
          >
            <ArrowLeft size={18} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            placeholder="Template name"
            className="flex-1 min-w-0 bg-transparent border-0 focus:outline-none text-lg font-semibold text-foreground placeholder:text-muted-foreground/60"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            v{template.version}
            {dirty && <span className="ml-2 text-[var(--brand-primary)]">• unsaved</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openPreview}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors"
          >
            <Eye size={15} /> Preview
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
        </div>
      </div>

      {/* Description field */}
      <div>
        <input
          type="text"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          placeholder="Optional internal description (not shown to customers)"
          className="w-full bg-transparent border-0 focus:outline-none text-sm text-muted-foreground placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Two-column layout: 60% editor, 40% sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 min-w-0">
          <TemplateEditor
            initialContent={template.content}
            onReady={handleEditorReady}
            onDirtyChange={(d) => {
              if (d) setDirty(true);
            }}
          />
        </div>
        <div className="lg:col-span-2 min-w-0">
          <MergeFieldSidebar
            onInsert={(fieldName) => {
              editorHandleRef.current?.insertMergeField(fieldName);
            }}
            defaultSignerCount={defaultSignerCount}
            onDefaultSignerCountChange={(c) => {
              setDefaultSignerCount(c);
              setDirty(true);
            }}
            signerRoleLabel={signerRoleLabel}
            onSignerRoleLabelChange={(l) => {
              setSignerRoleLabel(l);
              setDirty(true);
            }}
            isActive={isActive}
            onIsActiveChange={(a) => {
              setIsActive(a);
              setDirty(true);
            }}
          />
        </div>
      </div>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contentHtml={currentHtml}
      />
    </div>
  );
}
