"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// ── Pill selector options ──────────────────────────

const damageTypes = [
  { value: "water", label: "Water", color: "bg-[#E6F1FB] text-[#0C447C] border-[#0C447C]/20" },
  { value: "fire", label: "Fire", color: "bg-[#FAECE7] text-[#712B13] border-[#712B13]/20" },
  { value: "mold", label: "Mold", color: "bg-[#EAF3DE] text-[#27500A] border-[#27500A]/20" },
  { value: "storm", label: "Storm", color: "bg-[#EEEDFE] text-[#3C3489] border-[#3C3489]/20" },
  { value: "biohazard", label: "Biohazard", color: "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20" },
  { value: "contents", label: "Contents", color: "bg-[#FFF8E6] text-[#7A5E00] border-[#7A5E00]/20" },
  { value: "rebuild", label: "Rebuild", color: "bg-[#F1EFE8] text-[#5F5E5A] border-[#5F5E5A]/20" },
  { value: "other", label: "Other", color: "bg-[#F1EFE8] text-[#5F5E5A] border-[#5F5E5A]/20" },
];

const relationships = [
  { value: "homeowner", label: "Homeowner" },
  { value: "tenant", label: "Tenant" },
  { value: "property_manager", label: "Property Manager" },
  { value: "adjuster", label: "Adjuster" },
  { value: "insurance", label: "Insurance" },
];

const urgencyLevels = [
  { value: "emergency", label: "Emergency", color: "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/30" },
  { value: "urgent", label: "Urgent", color: "bg-[#FAEEDA] text-[#633806] border-[#633806]/30" },
  { value: "scheduled", label: "Scheduled", color: "bg-[#E6F1FB] text-[#0C447C] border-[#0C447C]/30" },
];

const propertyTypes = [
  { value: "single_family", label: "Single Family" },
  { value: "multi_family", label: "Multi Family" },
  { value: "commercial", label: "Commercial" },
  { value: "condo", label: "Condo" },
];

const insuranceOptions = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not Sure" },
];

// ── Form component ─────────────────────────────────

export default function IntakeForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Section 1: Name
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Section 2: Damage type
  const [damageType, setDamageType] = useState("");

  // Section 3: Relationship
  const [role, setRole] = useState("");

  // Section 4: Everything else
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [sqft, setSqft] = useState("");
  const [stories, setStories] = useState("");
  const [damageSource, setDamageSource] = useState("");
  const [whenHappened, setWhenHappened] = useState("");
  const [affectedAreas, setAffectedAreas] = useState("");
  const [urgency, setUrgency] = useState("scheduled");
  const [hasInsurance, setHasInsurance] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [adjusterName, setAdjusterName] = useState("");
  const [adjusterPhone, setAdjusterPhone] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!firstName || !damageType || !role || !propertyAddress) {
      toast.error("Please fill in required fields: Name, Damage Type, Relationship, and Property Address.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    try {
      // 1. Create contact
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .insert({
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          email: email || null,
          role,
          notes: notes || null,
        })
        .select()
        .single();

      if (contactErr) throw contactErr;

      // 2. Create adjuster contact if provided
      let adjusterContactId: string | null = null;
      if (adjusterName) {
        const nameParts = adjusterName.trim().split(" ");
        const { data: adjuster, error: adjErr } = await supabase
          .from("contacts")
          .insert({
            first_name: nameParts[0] || adjusterName,
            last_name: nameParts.slice(1).join(" ") || "",
            phone: adjusterPhone || null,
            role: "adjuster",
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
          contact_id: contact.id,
          damage_type: damageType,
          damage_source: damageSource || null,
          property_address: propertyAddress,
          property_type: propertyType || null,
          property_sqft: sqft ? parseInt(sqft) : null,
          property_stories: stories ? parseInt(stories) : null,
          affected_areas: affectedAreas || null,
          urgency,
          insurance_company: insuranceCompany || null,
          claim_number: claimNumber || null,
          adjuster_contact_id: adjusterContactId,
          access_notes: accessNotes || null,
        })
        .select()
        .single();

      if (jobErr) throw jobErr;

      // 4. Add initial activity note if there's a damage source or when it happened
      const activityParts = [];
      if (whenHappened) activityParts.push(`When it happened: ${whenHappened}`);
      if (damageSource) activityParts.push(`Source: ${damageSource}`);
      if (notes) activityParts.push(`Notes: ${notes}`);

      if (activityParts.length > 0) {
        await supabase.from("job_activities").insert({
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Section 1: Name ── */}
      <FormSection number={1} title="Customer Name">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label required>First Name</Label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
          </div>
          <div>
            <Label>Last Name</Label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
        </div>
      </FormSection>

      {/* ── Section 2: Damage Type ── */}
      <FormSection number={2} title="Type of Damage">
        <PillSelector
          options={damageTypes}
          value={damageType}
          onChange={setDamageType}
        />
      </FormSection>

      {/* ── Section 3: Relationship ── */}
      <FormSection number={3} title="Relationship to Property">
        <PillSelector
          options={relationships}
          value={role}
          onChange={setRole}
        />
      </FormSection>

      {/* ── Section 4: Details ── */}
      <FormSection number={4} title="Contact Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              type="tel"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@email.com"
              type="email"
            />
          </div>
        </div>
      </FormSection>

      <FormSection number={5} title="Property Details">
        <div className="space-y-4">
          <div>
            <Label required>Property Address</Label>
            <Input
              value={propertyAddress}
              onChange={(e) => setPropertyAddress(e.target.value)}
              placeholder="123 Main St, Austin, TX 78701"
            />
          </div>
          <div>
            <Label>Property Type</Label>
            <PillSelector
              options={propertyTypes}
              value={propertyType}
              onChange={setPropertyType}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Sq Ft (approx)</Label>
              <Input
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
                placeholder="2,000"
                type="number"
              />
            </div>
            <div>
              <Label>Stories</Label>
              <Input
                value={stories}
                onChange={(e) => setStories(e.target.value)}
                placeholder="1"
                type="number"
              />
            </div>
          </div>
          <div>
            <Label>Access Notes</Label>
            <Input
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate code, pets, special instructions..."
            />
          </div>
        </div>
      </FormSection>

      <FormSection number={6} title="Damage Details">
        <div className="space-y-4">
          <div>
            <Label>Source of Damage</Label>
            <Input
              value={damageSource}
              onChange={(e) => setDamageSource(e.target.value)}
              placeholder="Burst pipe, roof leak, kitchen fire..."
            />
          </div>
          <div>
            <Label>When Did It Happen?</Label>
            <Input
              value={whenHappened}
              onChange={(e) => setWhenHappened(e.target.value)}
              placeholder="Last night, 2 days ago, ongoing..."
            />
          </div>
          <div>
            <Label>Affected Areas</Label>
            <Input
              value={affectedAreas}
              onChange={(e) => setAffectedAreas(e.target.value)}
              placeholder="Kitchen, hallway, master bedroom..."
            />
          </div>
        </div>
      </FormSection>

      <FormSection number={7} title="Urgency">
        <PillSelector
          options={urgencyLevels}
          value={urgency}
          onChange={setUrgency}
        />
      </FormSection>

      <FormSection number={8} title="Insurance">
        <div className="space-y-4">
          <div>
            <Label>Insurance Claim?</Label>
            <PillSelector
              options={insuranceOptions}
              value={hasInsurance}
              onChange={setHasInsurance}
            />
          </div>
          {hasInsurance === "yes" && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Insurance Company</Label>
                  <Input
                    value={insuranceCompany}
                    onChange={(e) => setInsuranceCompany(e.target.value)}
                    placeholder="State Farm, Allstate..."
                  />
                </div>
                <div>
                  <Label>Claim Number</Label>
                  <Input
                    value={claimNumber}
                    onChange={(e) => setClaimNumber(e.target.value)}
                    placeholder="CLM-123456"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Adjuster Name</Label>
                  <Input
                    value={adjusterName}
                    onChange={(e) => setAdjusterName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <Label>Adjuster Phone</Label>
                  <Input
                    value={adjusterPhone}
                    onChange={(e) => setAdjusterPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    type="tel"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </FormSection>

      <FormSection number={9} title="Additional Notes">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else relevant about this job..."
          rows={4}
        />
      </FormSection>

      {/* Submit */}
      <div className="flex justify-end pt-4">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-[#C41E2A] hover:bg-[#A3171F] text-white px-8 py-3 text-base"
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

// ── Reusable sub-components ────────────────────────

function FormSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1B2434] text-white text-xs font-bold">
          {number}
        </span>
        <h2 className="text-base font-semibold text-[#1A1A1A]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Label({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-[#666666] mb-1.5">
      {children}
      {required && <span className="text-[#C41E2A] ml-0.5">*</span>}
    </label>
  );
}

function PillSelector({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; color?: string }[];
  value: string;
  onChange: (val: string) => void;
}) {
  return (
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
                ? opt.color || "bg-[#1B2434] text-white border-[#1B2434]"
                : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
