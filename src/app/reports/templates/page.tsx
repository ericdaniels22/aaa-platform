"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { PhotoReportTemplate } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Layers,
  Plus,
  Search,
  Users,
  Briefcase,
  Shield,
  Globe,
  Pencil,
  Trash2,
  LayoutGrid,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";
import { toast } from "sonner";
import ReportTemplateBuilder from "@/components/report-template-builder";

const AUDIENCE_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string; bg: string }
> = {
  adjuster: { label: "Adjuster", icon: Shield, color: "text-[#2B5EA7]", bg: "bg-[#E8F0FE]" },
  customer: { label: "Customer", icon: Users, color: "text-[#0F6E56]", bg: "bg-[#E1F5EE]" },
  internal: { label: "Internal", icon: Briefcase, color: "text-[#6C5CE7]", bg: "bg-[#F3F0FF]" },
  general: { label: "General", icon: Globe, color: "text-[#633806]", bg: "bg-[#FFF3E0]" },
};

const DEFAULT_TEMPLATES = [
  {
    name: "Insurance Adjuster Report",
    audience: "adjuster",
    photos_per_page: 2,
    cover_page: { show_logo: true, show_company: true, show_date: true, show_photo_count: true },
    sections: [
      { title: "Initial Damage Assessment", description: "Photos documenting the scope and extent of initial damage" },
      { title: "Moisture Readings", description: "Moisture meter readings and affected areas" },
      { title: "Equipment Placement", description: "Drying equipment setup and positioning" },
      { title: "Drying Progress", description: "Progress photos taken during the drying process" },
      { title: "Final Condition", description: "Photos showing completed restoration work" },
    ],
  },
  {
    name: "Customer Summary",
    audience: "customer",
    photos_per_page: 4,
    cover_page: { show_logo: true, show_company: true, show_date: true, show_photo_count: false },
    sections: [
      { title: "Before", description: "Condition before restoration began" },
      { title: "Work in Progress", description: "Key milestones during restoration" },
      { title: "After", description: "Final restored condition" },
    ],
  },
  {
    name: "Internal Documentation",
    audience: "internal",
    photos_per_page: 6,
    cover_page: { show_logo: false, show_company: false, show_date: true, show_photo_count: true },
    sections: [
      { title: "Site Arrival", description: "Conditions upon arrival" },
      { title: "Damage Documentation", description: "All damage photos for records" },
      { title: "Equipment Log", description: "Equipment used and placement" },
      { title: "Daily Progress", description: "Day-by-day progress photos" },
      { title: "Completion", description: "Final walkthrough photos" },
    ],
  },
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<PhotoReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhotoReportTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_report_templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setTemplates(data as PhotoReportTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const supabase = createClient();
    const { error } = await supabase
      .from("photo_report_templates")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete template");
    } else {
      toast.success("Template deleted");
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
    setDeleting(null);
  }

  function handleEdit(template: PhotoReportTemplate) {
    setEditingTemplate(template);
    setBuilderOpen(true);
  }

  function handleCreate() {
    setEditingTemplate(null);
    setBuilderOpen(true);
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("photo_report_templates")
      .insert(DEFAULT_TEMPLATES);

    if (error) {
      toast.error("Failed to create default templates");
      console.error(error);
    } else {
      toast.success("3 default templates created");
      fetchTemplates();
    }
    setSeeding(false);
  }

  const filtered = templates.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.audience.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="text-center py-12 text-[#999999]">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/reports"
            className="text-[#999999] hover:text-[#1A1A1A] transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">
              Report Templates
            </h1>
            <p className="text-sm text-[#999999] mt-1">
              {templates.length} template
              {templates.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {templates.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-[#6C5CE7] hover:bg-[#F3F0FF] transition-colors disabled:opacity-50"
            >
              <Sparkles size={16} />
              {seeding ? "Creating..." : "Add Defaults"}
            </button>
          )}
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[#2B5EA7] text-white hover:bg-[#244d8a] transition-colors"
          >
            <Plus size={16} />
            New Template
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999999]"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-9"
          />
        </div>
      </div>

      {/* Template list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Layers size={48} className="mx-auto text-[#CCCCCC] mb-3" />
          <p className="text-[#999999] text-lg font-medium">
            No templates yet
          </p>
          <p className="text-[#BBBBBB] text-sm mt-1">
            Create a template or add the default starter templates.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((template) => {
            const aud = AUDIENCE_CONFIG[template.audience] || AUDIENCE_CONFIG.general;
            const AudIcon = aud.icon;
            const sections = (template.sections as unknown[]) || [];
            const coverPage = (template.cover_page as Record<string, boolean>) || {};

            return (
              <div
                key={template.id}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                        aud.bg
                      )}
                    >
                      <AudIcon size={20} className={aud.color} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-[#1A1A1A]">
                        {template.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge
                          className={cn(
                            "text-[10px] px-1.5 py-0 rounded capitalize",
                            aud.bg,
                            aud.color
                          )}
                        >
                          {aud.label}
                        </Badge>
                        <span className="text-xs text-[#999999] flex items-center gap-1">
                          <LayoutGrid size={10} />
                          {template.photos_per_page} photo
                          {template.photos_per_page !== 1 ? "s" : ""}/page
                        </span>
                        <span className="text-xs text-[#999999]">
                          {sections.length} section
                          {sections.length !== 1 ? "s" : ""}
                        </span>
                        {coverPage.show_logo && (
                          <span className="text-xs text-[#BBBBBB]">
                            Cover page
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#BBBBBB] mt-1">
                        Created{" "}
                        {format(new Date(template.created_at), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(template)}
                      className="p-2 rounded-lg text-[#999999] hover:text-[#2B5EA7] hover:bg-blue-50 transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id, template.name)}
                      disabled={deleting === template.id}
                      className="p-2 rounded-lg text-[#999999] hover:text-[#C41E2A] hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template Builder Modal */}
      <ReportTemplateBuilder
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditingTemplate(null);
        }}
        onSaved={fetchTemplates}
        editTemplate={editingTemplate}
      />
    </div>
  );
}
