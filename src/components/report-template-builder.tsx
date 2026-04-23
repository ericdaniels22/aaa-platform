"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { PhotoReportTemplate } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TemplateSection {
  title: string;
  description: string;
}

interface CoverPageConfig {
  show_logo: boolean;
  show_company: boolean;
  show_date: boolean;
  show_photo_count: boolean;
}

const DEFAULT_COVER_PAGE: CoverPageConfig = {
  show_logo: true,
  show_company: true,
  show_date: true,
  show_photo_count: true,
};

const AUDIENCE_OPTIONS = [
  { value: "adjuster", label: "Insurance Adjuster" },
  { value: "customer", label: "Customer" },
  { value: "internal", label: "Internal" },
  { value: "general", label: "General" },
] as const;

const PHOTOS_PER_PAGE_OPTIONS = [1, 2, 4, 6] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editTemplate?: PhotoReportTemplate | null;
}

export default function ReportTemplateBuilder({
  open,
  onOpenChange,
  onSaved,
  editTemplate,
}: Props) {
  const isEditing = !!editTemplate;

  const [name, setName] = useState(editTemplate?.name ?? "");
  const [audience, setAudience] = useState<string>(
    editTemplate?.audience ?? "general"
  );
  const [photosPerPage, setPhotosPerPage] = useState<number>(
    editTemplate?.photos_per_page ?? 2
  );
  const [coverPage, setCoverPage] = useState<CoverPageConfig>(
    (editTemplate?.cover_page as unknown as CoverPageConfig) ?? { ...DEFAULT_COVER_PAGE }
  );
  const [sections, setSections] = useState<TemplateSection[]>(
    (editTemplate?.sections as TemplateSection[]) ?? [
      { title: "", description: "" },
    ]
  );
  const [saving, setSaving] = useState(false);

  function addSection() {
    setSections([...sections, { title: "", description: "" }]);
  }

  function removeSection(index: number) {
    setSections(sections.filter((_, i) => i !== index));
  }

  function updateSection(
    index: number,
    field: keyof TemplateSection,
    value: string
  ) {
    const updated = [...sections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  }

  function moveSection(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sections.length) return;
    const updated = [...sections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setSections(updated);
  }

  function toggleCoverPage(key: keyof CoverPageConfig) {
    setCoverPage({ ...coverPage, [key]: !coverPage[key] });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }

    const validSections = sections.filter((s) => s.title.trim());
    if (validSections.length === 0) {
      toast.error("Add at least one section with a title");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      audience,
      photos_per_page: photosPerPage,
      cover_page: coverPage,
      sections: validSections,
    };

    let error;
    if (isEditing) {
      ({ error } = await supabase
        .from("photo_report_templates")
        .update(payload)
        .eq("id", editTemplate.id)
        .eq("organization_id", await getActiveOrganizationId(supabase)));
    } else {
      ({ error } = await supabase
        .from("photo_report_templates")
        .insert({ ...payload, organization_id: await getActiveOrganizationId(supabase) }));
    }

    if (error) {
      toast.error("Failed to save template");
      console.error(error);
    } else {
      toast.success(isEditing ? "Template updated" : "Template created");
      onSaved();
      onOpenChange(false);
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Template" : "Create Report Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Template name */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-1">
              Template Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Insurance Adjuster Report"
            />
          </div>

          {/* Audience */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-1">
              Audience
            </label>
            <div className="grid grid-cols-2 gap-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setAudience(opt.value)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm font-medium border transition-all text-left",
                    audience === opt.value
                      ? "bg-[#1B2434] text-white border-[#1B2434]"
                      : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Photos per page */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-1">
              Photos Per Page
            </label>
            <div className="flex gap-2">
              {PHOTOS_PER_PAGE_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setPhotosPerPage(n)}
                  className={cn(
                    "w-12 h-10 rounded-lg text-sm font-medium border transition-all",
                    photosPerPage === n
                      ? "bg-[#2B5EA7] text-white border-[#2B5EA7]"
                      : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Cover page toggles */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-2">
              Cover Page
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "show_logo", label: "Company Logo" },
                  { key: "show_company", label: "Company Name" },
                  { key: "show_date", label: "Report Date" },
                  { key: "show_photo_count", label: "Photo Count" },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={coverPage[item.key]}
                    onChange={() => toggleCoverPage(item.key)}
                    className="rounded border-gray-300 text-[#2B5EA7] focus:ring-[#2B5EA7]"
                  />
                  <span className="text-sm text-[#1A1A1A]">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#666666]">
                Sections ({sections.length})
              </label>
              <button
                onClick={addSection}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#2B5EA7] hover:text-[#1d4a8a] transition-colors"
              >
                <Plus size={14} />
                Add Section
              </button>
            </div>

            <div className="space-y-3">
              {sections.map((section, i) => (
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg p-3 bg-gray-50/50"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 pt-1">
                      <button
                        onClick={() => moveSection(i, "up")}
                        disabled={i === 0}
                        className="text-[#999999] hover:text-[#1A1A1A] disabled:opacity-30 transition-colors"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => moveSection(i, "down")}
                        disabled={i === sections.length - 1}
                        className="text-[#999999] hover:text-[#1A1A1A] disabled:opacity-30 transition-colors"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={section.title}
                        onChange={(e) =>
                          updateSection(i, "title", e.target.value)
                        }
                        placeholder="Section title (e.g. Initial Damage)"
                        className="text-sm"
                      />
                      <Input
                        value={section.description}
                        onChange={(e) =>
                          updateSection(i, "description", e.target.value)
                        }
                        placeholder="Optional description"
                        className="text-sm"
                      />
                    </div>
                    <button
                      onClick={() => removeSection(i)}
                      disabled={sections.length <= 1}
                      className="p-1.5 text-[#999999] hover:text-[#C41E2A] disabled:opacity-30 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-[#666666] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[#2B5EA7] text-white hover:bg-[#244d8a] disabled:opacity-50 transition-colors"
          >
            {saving
              ? "Saving..."
              : isEditing
              ? "Update Template"
              : "Create Template"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
