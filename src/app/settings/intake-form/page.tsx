"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { FormConfig, FormSection, FormField, FormFieldOption } from "@/lib/types";

const FIELD_TYPES = [
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

export default function IntakeFormBuilderPage() {
  const [config, setConfig] = useState<FormConfig>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  // Expanded section tracking
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Add section form
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  // Field editor
  const [editingField, setEditingField] = useState<{ sectionId: string; fieldId: string } | null>(null);

  const fetchConfig = useCallback(async () => {
    const res = await fetch("/api/settings/intake-form");
    if (res.ok) {
      const data = await res.json();
      if (data.config?.sections) {
        setConfig(data.config);
        setVersion(data.version || 0);
        // Expand all sections by default
        setExpandedSections(new Set(data.config.sections.map((s: FormSection) => s.id)));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  function updateConfig(newConfig: FormConfig) {
    setConfig(newConfig);
  }

  // Section operations
  function addSection() {
    if (!newSectionTitle.trim()) return;
    const id = "custom_" + Date.now();
    const newSection: FormSection = {
      id,
      title: newSectionTitle.trim(),
      is_default: false,
      visible: true,
      fields: [],
    };
    updateConfig({ sections: [...config.sections, newSection] });
    setExpandedSections((prev) => new Set([...prev, id]));
    setNewSectionTitle("");
    setShowAddSection(false);
  }

  function removeSection(sectionId: string) {
    updateConfig({ sections: config.sections.filter((s) => s.id !== sectionId) });
  }

  function toggleSectionVisibility(sectionId: string) {
    updateConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, visible: !s.visible } : s
      ),
    });
  }

  function moveSectionUp(index: number) {
    if (index === 0) return;
    const sections = [...config.sections];
    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
    updateConfig({ sections });
  }

  function moveSectionDown(index: number) {
    if (index === config.sections.length - 1) return;
    const sections = [...config.sections];
    [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
    updateConfig({ sections });
  }

  function toggleExpanded(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  // Field operations
  function addField(sectionId: string) {
    const fieldId = "custom_" + Date.now();
    const newField: FormField = {
      id: fieldId,
      type: "text",
      label: "New Field",
      required: false,
      is_default: false,
      visible: true,
    };
    updateConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    setEditingField({ sectionId, fieldId });
  }

  function removeField(sectionId: string, fieldId: string) {
    updateConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId
          ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) }
          : s
      ),
    });
    if (editingField?.fieldId === fieldId) setEditingField(null);
  }

  function updateField(sectionId: string, fieldId: string, updates: Partial<FormField>) {
    updateConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === fieldId ? { ...f, ...updates } : f
              ),
            }
          : s
      ),
    });
  }

  function toggleFieldVisibility(sectionId: string, fieldId: string) {
    const section = config.sections.find((s) => s.id === sectionId);
    const field = section?.fields.find((f) => f.id === fieldId);
    if (field) updateField(sectionId, fieldId, { visible: !field.visible });
  }

  function moveFieldUp(sectionId: string, index: number) {
    if (index === 0) return;
    updateConfig({
      sections: config.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const fields = [...s.fields];
        [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
        return { ...s, fields };
      }),
    });
  }

  function moveFieldDown(sectionId: string, index: number) {
    const section = config.sections.find((s) => s.id === sectionId);
    if (!section || index === section.fields.length - 1) return;
    updateConfig({
      sections: config.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const fields = [...s.fields];
        [fields[index], fields[index + 1]] = [fields[index + 1], fields[index]];
        return { ...s, fields };
      }),
    });
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/settings/intake-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    if (res.ok) {
      const data = await res.json();
      setVersion(data.version);
      toast.success(`Form saved (v${data.version})`);
    } else {
      toast.error("Failed to save form config");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Intake Form Builder</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customize the fields shown on the intake form. Version {version}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddSection(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card text-foreground hover:bg-accent transition-colors"
          >
            <Plus size={16} />
            Add Section
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving..." : "Save Form"}
          </button>
        </div>
      </div>

      {/* Add section form */}
      {showAddSection && (
        <div className="bg-card rounded-xl border border-border p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Section Title</label>
            <Input value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} placeholder="e.g. Equipment Needed" />
          </div>
          <button onClick={addSection} className="px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all">
            Add
          </button>
          <button onClick={() => setShowAddSection(false)} className="px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground">
            Cancel
          </button>
        </div>
      )}

      {/* Sections */}
      {config.sections.map((section, si) => (
        <div
          key={section.id}
          className={cn(
            "bg-card rounded-xl border border-border overflow-hidden",
            !section.visible && "opacity-50"
          )}
        >
          {/* Section header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveSectionUp(si)} disabled={si === 0} className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20">
                <ChevronUp size={12} />
              </button>
              <button onClick={() => moveSectionDown(si)} disabled={si === config.sections.length - 1} className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20">
                <ChevronDown size={12} />
              </button>
            </div>

            <button onClick={() => toggleExpanded(section.id)} className="flex-1 text-left">
              <span className="text-sm font-semibold text-foreground">{section.title}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {section.fields.filter((f) => f.visible !== false).length} field{section.fields.filter((f) => f.visible !== false).length !== 1 ? "s" : ""}
              </span>
            </button>

            <div className="flex items-center gap-1">
              {section.is_default && <Lock size={12} className="text-muted-foreground/40" />}
              <button onClick={() => toggleSectionVisibility(section.id)} className="p-1 rounded text-muted-foreground hover:text-foreground" title={section.visible ? "Hide" : "Show"}>
                {section.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              {!section.is_default && (
                <button onClick={() => removeSection(section.id)} className="p-1 rounded text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </button>
              )}
              <button onClick={() => toggleExpanded(section.id)} className="p-1 rounded text-muted-foreground">
                {expandedSections.has(section.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {/* Fields */}
          {expandedSections.has(section.id) && (
            <div className="p-3 space-y-1">
              {section.fields.map((field, fi) => (
                <div key={field.id}>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors",
                      !field.visible && "opacity-40",
                      editingField?.fieldId === field.id && "bg-muted/50 ring-1 ring-[var(--brand-primary)]/20"
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveFieldUp(section.id, fi)} disabled={fi === 0} className="text-muted-foreground/30 hover:text-foreground disabled:opacity-20">
                        <GripVertical size={10} className="rotate-180" />
                      </button>
                      <button onClick={() => moveFieldDown(section.id, fi)} disabled={fi === section.fields.length - 1} className="text-muted-foreground/30 hover:text-foreground disabled:opacity-20">
                        <GripVertical size={10} />
                      </button>
                    </div>

                    <button onClick={() => setEditingField(editingField?.fieldId === field.id ? null : { sectionId: section.id, fieldId: field.id })} className="flex-1 text-left flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{field.type}</span>
                      <span className="text-sm text-foreground">{field.label}</span>
                      {field.required && <span className="text-[10px] text-destructive font-medium">Required</span>}
                      {field.maps_to && <span className="text-[10px] text-muted-foreground/60">{field.maps_to}</span>}
                    </button>

                    <div className="flex items-center gap-0.5">
                      {field.is_default && <Lock size={10} className="text-muted-foreground/40" />}
                      <button onClick={() => toggleFieldVisibility(section.id, field.id)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                        {field.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                      {!field.is_default && (
                        <button onClick={() => removeField(section.id, field.id)} className="p-1 rounded text-muted-foreground hover:text-destructive">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Field editor */}
                  {editingField?.sectionId === section.id && editingField.fieldId === field.id && (
                    <FieldEditor
                      field={field}
                      isDefault={!!field.is_default}
                      onUpdate={(updates) => updateField(section.id, field.id, updates)}
                      onClose={() => setEditingField(null)}
                    />
                  )}
                </div>
              ))}

              <button
                onClick={() => addField(section.id)}
                className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
              >
                <Plus size={14} />
                Add Field
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FieldEditor({
  field,
  isDefault,
  onUpdate,
  onClose,
}: {
  field: FormField;
  isDefault: boolean;
  onUpdate: (updates: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const hasOptions = field.type === "select" || field.type === "pill";
  const [newOption, setNewOption] = useState("");

  function addOption() {
    if (!newOption.trim()) return;
    const opts = field.options || [];
    onUpdate({ options: [...opts, { value: newOption.trim().toLowerCase().replace(/\s+/g, "_"), label: newOption.trim() }] });
    setNewOption("");
  }

  function removeOption(index: number) {
    const opts = [...(field.options || [])];
    opts.splice(index, 1);
    onUpdate({ options: opts });
  }

  return (
    <div className="ml-8 mr-2 my-2 p-3 rounded-lg border border-border bg-background space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase">Field Settings</span>
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
          <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} className="h-8 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as FormField["type"] })}
            disabled={isDefault}
            className="w-full h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-50"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Placeholder</label>
          <Input value={field.placeholder || ""} onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })} className="h-8 text-sm" placeholder="Optional" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Help Text</label>
          <Input value={field.help_text || ""} onChange={(e) => onUpdate({ help_text: e.target.value || undefined })} className="h-8 text-sm" placeholder="Optional" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={field.required || false} onChange={(e) => onUpdate({ required: e.target.checked })} className="w-4 h-4 rounded accent-[var(--brand-primary)]" />
          <span className="text-foreground">Required</span>
        </label>
      </div>

      {/* Options for select/pill types */}
      {hasOptions && !field.options_source && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Options</label>
          <div className="space-y-1">
            {(field.options || []).map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-foreground flex-1">{opt.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{opt.value}</span>
                {!isDefault && (
                  <button onClick={() => removeOption(i)} className="p-0.5 rounded text-muted-foreground hover:text-destructive">
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!isDefault && (
            <div className="flex gap-2 mt-2">
              <Input value={newOption} onChange={(e) => setNewOption(e.target.value)} placeholder="New option" className="h-7 text-xs flex-1" onKeyDown={(e) => e.key === "Enter" && addOption()} />
              <button onClick={addOption} className="px-2 py-1 rounded text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all">Add</button>
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
  );
}
