"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfig } from "@/lib/config-context";
import type { FormConfig, FormSection, FormField } from "@/lib/types";

export default function IntakeForm() {
  const router = useRouter();
  const { damageTypes } = useConfig();
  const [submitting, setSubmitting] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  // Load form config
  useEffect(() => {
    fetch("/api/settings/intake-form")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.config?.sections) {
          setFormConfig(data.config);
          // Set default values
          const defaults: Record<string, string> = {};
          for (const section of data.config.sections) {
            for (const field of section.fields) {
              if (field.default_value) defaults[field.id] = field.default_value;
            }
          }
          setValues(defaults);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  function setValue(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function getVal(id: string): string {
    return values[id] || "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate required fields
    if (formConfig) {
      for (const section of formConfig.sections) {
        if (section.visible === false) continue;
        for (const field of section.fields) {
          if (field.visible === false) continue;
          if (field.required && !getVal(field.id)) {
            toast.error(`Please fill in: ${field.label}`);
            return;
          }
          // Check show_when condition
          if (field.show_when) {
            const [depId, depVal] = field.show_when.split("=");
            if (getVal(depId) !== depVal) continue; // hidden, skip validation
          }
        }
      }
    }

    if (!getVal("first_name") || !getVal("damage_type") || !getVal("property_address")) {
      toast.error("Please fill in required fields: Name, Damage Type, and Property Address.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const orgId = await getActiveOrganizationId(supabase);
    if (!orgId) {
      toast.error("No active organization — please sign in again.");
      setSubmitting(false);
      return;
    }

    try {
      // 1. Create contact
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .insert({
          organization_id: orgId,
          first_name: getVal("first_name"),
          last_name: getVal("last_name"),
          phone: getVal("phone") || null,
          email: getVal("email") || null,
          role: getVal("role") || "homeowner",
          notes: getVal("notes") || null,
        })
        .select()
        .single();

      if (contactErr) throw contactErr;

      // 2. Create adjuster contact if provided
      let adjusterContactId: string | null = null;
      if (getVal("adjuster_name")) {
        const nameParts = getVal("adjuster_name").trim().split(" ");
        const { data: adjuster, error: adjErr } = await supabase
          .from("contacts")
          .insert({
            organization_id: orgId,
            first_name: nameParts[0] || getVal("adjuster_name"),
            last_name: nameParts.slice(1).join(" ") || "",
            phone: getVal("adjuster_phone") || null,
            role: "adjuster",
            title: getVal("adjuster_title") || null,
          })
          .select()
          .single();

        if (adjErr) throw adjErr;
        adjusterContactId = adjuster.id;
      }

      // 3. Create job
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert({
          organization_id: orgId,
          contact_id: contact.id,
          damage_type: getVal("damage_type"),
          damage_source: getVal("damage_source") || null,
          property_address: getVal("property_address"),
          property_type: getVal("property_type") || null,
          property_sqft: getVal("property_sqft") ? parseInt(getVal("property_sqft")) : null,
          property_stories: getVal("property_stories") ? parseInt(getVal("property_stories")) : null,
          affected_areas: getVal("affected_areas") || null,
          urgency: getVal("urgency") || "scheduled",
          insurance_company: getVal("insurance_company") || null,
          claim_number: getVal("claim_number") || null,
          access_notes: getVal("access_notes") || null,
        })
        .select()
        .single();

      if (jobErr) throw jobErr;

      // Link adjuster to job via job_adjusters if one was created
      if (adjusterContactId && job) {
        const { error: adjLinkErr } = await supabase
          .from("job_adjusters")
          .insert({
            organization_id: orgId,
            job_id: job.id,
            contact_id: adjusterContactId,
            is_primary: true,
          });
        if (adjLinkErr) throw adjLinkErr;
      }

      // 4. Save custom fields (fields without maps_to)
      if (formConfig) {
        const customFields: { organization_id: string; job_id: string; field_key: string; field_value: string }[] = [];
        for (const section of formConfig.sections) {
          for (const field of section.fields) {
            if (!field.maps_to && !field.is_default && getVal(field.id)) {
              customFields.push({
                organization_id: orgId,
                job_id: job.id,
                field_key: field.id,
                field_value: getVal(field.id),
              });
            }
          }
        }
        if (customFields.length > 0) {
          await supabase.from("job_custom_fields").insert(customFields);
        }
      }

      // 5. Add initial activity note
      const activityParts = [];
      if (getVal("when_happened")) activityParts.push(`When it happened: ${getVal("when_happened")}`);
      if (getVal("damage_source")) activityParts.push(`Source: ${getVal("damage_source")}`);
      if (getVal("notes")) activityParts.push(`Notes: ${getVal("notes")}`);

      if (activityParts.length > 0) {
        await supabase.from("job_activities").insert({
          organization_id: orgId,
          job_id: job.id,
          activity_type: "note",
          title: "Intake notes",
          description: activityParts.join("\n"),
          author: "Eric",
        });
      }

      toast.success(`Job ${job.job_number} created successfully!`);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingConfig) {
    return <div className="text-center py-12 text-muted-foreground">Loading form...</div>;
  }

  if (!formConfig || formConfig.sections.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No form configuration found.</p>
        <a href="/settings/intake-form" className="text-sm text-[var(--brand-primary)] hover:underline mt-1 inline-block">
          Set up the intake form
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {formConfig.sections
        .filter((s) => s.visible !== false)
        .map((section, si) => (
          <SectionCard key={section.id} number={si + 1} title={section.title}>
            <div className="space-y-4">
              {section.fields
                .filter((f) => f.visible !== false)
                .filter((f) => {
                  // Check show_when condition
                  if (f.show_when) {
                    const [depId, depVal] = f.show_when.split("=");
                    return getVal(depId) === depVal;
                  }
                  return true;
                })
                .map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={getVal(field.id)}
                    onChange={(v) => setValue(field.id, v)}
                    damageTypes={damageTypes}
                  />
                ))}
            </div>
          </SectionCard>
        ))}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Job...
            </>
          ) : (
            "Create Job"
          )}
        </Button>
      </div>
    </form>
  );
}

// ── Dynamic field renderer ──────────────────────────

function DynamicField({
  field,
  value,
  onChange,
  damageTypes,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  damageTypes: { name: string; display_label: string; bg_color: string; text_color: string }[];
}) {
  // Get options — from damage_types config or field.options
  let options = field.options || [];
  if (field.options_source === "damage_types") {
    options = damageTypes.map((dt) => ({
      value: dt.name,
      label: dt.display_label,
      color: `bg-[${dt.bg_color}] text-[${dt.text_color}] border-[${dt.text_color}]/20`,
    }));
  }

  return (
    <div>
      {field.type !== "checkbox" && (
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          {field.label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}

      {field.help_text && (
        <p className="text-xs text-muted-foreground/70 mb-1.5">{field.help_text}</p>
      )}

      {(field.type === "text" || field.type === "phone" || field.type === "email") && (
        <Input
          type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "date" && (
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
        />
      )}

      {field.type === "select" && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === "pill" && (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
                  isSelected
                    ? opt.color || "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                    : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {field.type === "checkbox" && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="w-4 h-4 rounded accent-[var(--brand-primary)]"
          />
          <span className="text-sm text-foreground">{field.label}</span>
        </label>
      )}
    </div>
  );
}

// ── Section card wrapper ────────────────────────────

function SectionCard({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-secondary text-white text-xs font-bold">
          {number}
        </span>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}
