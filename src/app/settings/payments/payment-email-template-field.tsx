"use client";

import { useRef, useState } from "react";
import TiptapEditor from "@/components/tiptap-editor";
import { ChevronDown, Plus } from "lucide-react";
import {
  MERGE_FIELD_CATEGORIES,
  mergeFieldsByCategory,
} from "@/lib/contracts/merge-fields";
import {
  PAYMENT_MERGE_FIELD_CATEGORIES,
  paymentMergeFieldsByCategory,
} from "@/lib/payments/merge-fields";

export interface PaymentEmailTemplateFieldProps {
  label: string;
  description?: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}

export default function PaymentEmailTemplateField({
  label,
  description,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: PaymentEmailTemplateFieldProps) {
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [bodyMenuOpen, setBodyMenuOpen] = useState(false);
  const subjectInputRef = useRef<HTMLInputElement | null>(null);

  const contractGrouped = mergeFieldsByCategory();
  const paymentGrouped = paymentMergeFieldsByCategory();

  function insertIntoSubject(fieldName: string) {
    const el = subjectInputRef.current;
    const insert = `{{${fieldName}}}`;
    if (!el) {
      onSubjectChange(subject + insert);
      setSubjectMenuOpen(false);
      return;
    }
    const start = el.selectionStart ?? subject.length;
    const end = el.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + insert + subject.slice(end);
    onSubjectChange(next);
    setSubjectMenuOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function insertIntoBody(fieldName: string) {
    onBodyChange(body + ` {{${fieldName}}}`);
    setBodyMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <MergeFieldDropdown
            open={subjectMenuOpen}
            setOpen={setSubjectMenuOpen}
            contractGrouped={contractGrouped}
            paymentGrouped={paymentGrouped}
            onPick={insertIntoSubject}
          />
        </div>
        <input
          ref={subjectInputRef}
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
          placeholder="Subject line"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <MergeFieldDropdown
            open={bodyMenuOpen}
            setOpen={setBodyMenuOpen}
            contractGrouped={contractGrouped}
            paymentGrouped={paymentGrouped}
            onPick={insertIntoBody}
          />
        </div>
        <TiptapEditor
          content={body}
          onChange={onBodyChange}
          placeholder="Email body. Use merge fields to insert data at send time."
        />
      </div>
    </div>
  );
}

function MergeFieldDropdown({
  open,
  setOpen,
  contractGrouped,
  paymentGrouped,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  contractGrouped: ReturnType<typeof mergeFieldsByCategory>;
  paymentGrouped: ReturnType<typeof paymentMergeFieldsByCategory>;
  onPick: (fieldName: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 transition-colors"
      >
        <Plus size={12} /> Merge Field <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl z-40 p-2">
          {PAYMENT_MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {paymentGrouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {contractGrouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
