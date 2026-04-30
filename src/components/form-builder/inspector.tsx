"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { X, Lock } from "lucide-react";
import type { FormField } from "@/lib/types";

const FIELD_TYPES: { value: FormField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "select", label: "Dropdown" },
  { value: "pill", label: "Pill Selector" },
  { value: "checkbox", label: "Checkbox" },
];

export function Inspector({
  field,
  onUpdate,
  onClose,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const isDefault = !!field.is_default;
  const hasOptions = field.type === "select" || field.type === "pill";
  const [newOption, setNewOption] = useState("");

  function addOption() {
    if (!newOption.trim()) return;
    const opts = field.options || [];
    onUpdate({
      options: [
        ...opts,
        {
          value: newOption.trim().toLowerCase().replace(/\s+/g, "_"),
          label: newOption.trim(),
        },
      ],
    });
    setNewOption("");
  }

  function removeOption(index: number) {
    const opts = [...(field.options || [])];
    opts.splice(index, 1);
    onUpdate({ options: opts });
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Field Settings</h3>
          {isDefault && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Lock size={10} /> Built-in field — type and key are locked
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Close inspector"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
          <Input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as FormField["type"] })}
            disabled={isDefault}
            className="w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-50"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {!isDefault && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Changing type preserves label, placeholder, help text, and required status.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Placeholder</label>
          <Input
            value={field.placeholder || ""}
            onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Help Text</label>
          <Input
            value={field.help_text || ""}
            onChange={(e) => onUpdate({ help_text: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={field.required || false}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="w-4 h-4 rounded accent-[var(--brand-primary)]"
          />
          <span className="text-foreground">Required</span>
        </label>

        {hasOptions && !field.options_source && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Options</label>
            <div className="space-y-1">
              {(field.options || []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/40">
                  <span className="text-sm text-foreground flex-1">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{opt.value}</span>
                  {!isDefault && (
                    <button
                      onClick={() => removeOption(i)}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                      aria-label="Remove option"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isDefault && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="New option"
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                />
                <button
                  onClick={addOption}
                  className="px-3 py-1 rounded text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        {field.options_source && (
          <p className="text-xs text-muted-foreground">
            Options loaded dynamically from <span className="font-mono">{field.options_source}</span>
          </p>
        )}
      </div>
    </aside>
  );
}
