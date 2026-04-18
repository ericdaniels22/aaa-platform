"use client";

import { MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";

interface MergeFieldSidebarProps {
  onInsert: (fieldName: string) => void;
  // Template settings
  defaultSignerCount: 1 | 2;
  onDefaultSignerCountChange: (count: 1 | 2) => void;
  signerRoleLabel: string;
  onSignerRoleLabelChange: (label: string) => void;
  isActive: boolean;
  onIsActiveChange: (active: boolean) => void;
}

export default function MergeFieldSidebar({
  onInsert,
  defaultSignerCount,
  onDefaultSignerCountChange,
  signerRoleLabel,
  onSignerRoleLabelChange,
  isActive,
  onIsActiveChange,
}: MergeFieldSidebarProps) {
  const grouped = mergeFieldsByCategory();

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Available merge fields */}
      <section className="rounded-xl border border-border bg-card p-4">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Merge Fields</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click or drag a field into the editor. They resolve when a contract is previewed or sent.
          </p>
        </header>
        <div className="space-y-3">
          {MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {grouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onInsert(f.name)}
                    title={f.label}
                    className="merge-field-pill cursor-pointer hover:brightness-110 text-left"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Template settings */}
      <section className="rounded-xl border border-border bg-card p-4">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Settings</h3>
        </header>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Default Signer Count
            </label>
            <select
              value={defaultSignerCount}
              onChange={(e) =>
                onDefaultSignerCountChange(Number(e.target.value) === 2 ? 2 : 1)
              }
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            >
              <option value={1}>1 — Single signer</option>
              <option value={2}>2 — Co-signer</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Signer Role Label
            </label>
            <input
              type="text"
              value={signerRoleLabel}
              onChange={(e) => onSignerRoleLabelChange(e.target.value)}
              placeholder="e.g. Homeowner, Property Manager"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Displayed on the signing page above the signer&apos;s signature line.
            </p>
          </div>

          <div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Active</div>
                <div className="text-[11px] text-muted-foreground">
                  Inactive templates are hidden from send menus but kept for audit.
                </div>
              </div>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => onIsActiveChange(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[var(--brand-primary)] shrink-0"
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
