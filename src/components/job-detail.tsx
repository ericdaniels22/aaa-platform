"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Job, JobActivity, Payment, Photo, PhotoTag, PhotoReport, Email } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import ActivityTimeline from "@/components/activity-timeline";
import RecordPaymentModal from "@/components/record-payment";
import PhotoUploadModal from "@/components/photo-upload";
import PhotoDetailModal from "@/components/photo-detail";
import PhotoAnnotator from "@/components/photo-annotator";
import ComposeEmailModal from "@/components/compose-email";
import {
  MapPin,
  Home,
  Layers,
  Ruler,
  KeyRound,
  Phone,
  Mail,
  Building,
  FileText,
  User,
  ArrowLeft,
  Droplets,
  Camera,
  Image as ImageIcon,
  Pencil,
  Inbox,
  Send,
  Clock,
} from "lucide-react";
import {
  statusColors,
  statusLabels,
  urgencyColors,
  urgencyLabels,
  damageTypeColors,
  damageTypeLabels,
} from "@/lib/badge-colors";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import Link from "next/link";

const propertyTypeLabels: Record<string, string> = {
  single_family: "Single Family",
  multi_family: "Multi Family",
  commercial: "Commercial",
  condo: "Condo",
};

export default function JobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [activities, setActivities] = useState<JobActivity[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [reports, setReports] = useState<PhotoReport[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [customFields, setCustomFields] = useState<{ field_key: string; field_value: string }[]>([]);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDefaults, setComposeDefaults] = useState({ to: "", subject: "", replyToMessageId: "" });
  const [loading, setLoading] = useState(true);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [photoUploadOpen, setPhotoUploadOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<Photo | null>(null);
  const [annotatorUrl, setAnnotatorUrl] = useState("");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [jobRes, activitiesRes, paymentsRes, photosRes, tagsRes, reportsRes, emailsRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("*, contact:contacts!contact_id(*), adjuster:contacts!adjuster_contact_id(*)")
        .eq("id", jobId)
        .single(),
      supabase
        .from("job_activities")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("photos")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase.from("photo_tags").select("*").order("name"),
      supabase
        .from("photo_reports")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("emails")
        .select("*")
        .eq("job_id", jobId)
        .order("received_at", { ascending: false }),
    ]);

    if (jobRes.data) setJob(jobRes.data as Job);
    if (activitiesRes.data) setActivities(activitiesRes.data as JobActivity[]);
    if (paymentsRes.data) setPayments(paymentsRes.data as Payment[]);
    if (photosRes.data) setPhotos(photosRes.data as Photo[]);
    if (tagsRes.data) setTags(tagsRes.data as PhotoTag[]);
    if (reportsRes.data) setReports(reportsRes.data as PhotoReport[]);
    if (emailsRes.data) setEmails(emailsRes.data as Email[]);

    // Fetch custom fields
    const { data: cfData } = await supabase
      .from("job_custom_fields")
      .select("field_key, field_value")
      .eq("job_id", jobId);
    if (cfData) setCustomFields(cfData);

    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function updateStatus(newStatus: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ status: newStatus })
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to update status.");
    } else {
      toast.success(`Status updated to ${statusLabels[newStatus]}.`);
      fetchData();
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-[#999999]">Loading job...</div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-[#999999] text-lg">Job not found.</p>
        <Link href="/jobs" className="text-[#2B5EA7] text-sm hover:underline mt-2 inline-block">
          Back to jobs
        </Link>
      </div>
    );
  }

  const contactName = job.contact
    ? `${job.contact.first_name} ${job.contact.last_name}`
    : "Unknown";

  const totalPaid = payments
    .filter((p) => p.status === "received")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const insurancePaid = payments
    .filter((p) => p.status === "received" && p.source === "insurance")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const homeownerPaid = payments
    .filter((p) => p.status === "received" && p.source === "homeowner")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="max-w-6xl">
      {/* Back link */}
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-[#666666] hover:text-[#1A1A1A] mb-4"
      >
        <ArrowLeft size={16} />
        Back to Jobs
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-sm font-mono text-[#999999]">{job.job_number}</p>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">{contactName}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                urgencyColors[job.urgency]
              )}
            >
              {urgencyLabels[job.urgency]}
            </Badge>
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                damageTypeColors[job.damage_type]
              )}
            >
              {damageTypeLabels[job.damage_type]}
            </Badge>
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                statusColors[job.status]
              )}
            >
              {statusLabels[job.status]}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={job.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="w-[180px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#2B5EA7]/20 focus:border-[#2B5EA7]"
          >
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="pending_invoice">Pending Invoice</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Job Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-[#1A1A1A] mb-4">
            Job Info
          </h3>
          <div className="space-y-3 text-sm">
            <InfoRow icon={MapPin} label="Address" value={job.property_address} />
            {job.property_type && (
              <InfoRow
                icon={Home}
                label="Property Type"
                value={propertyTypeLabels[job.property_type] || job.property_type}
              />
            )}
            {job.property_sqft && (
              <InfoRow icon={Ruler} label="Sq Ft" value={`${job.property_sqft.toLocaleString()} sq ft`} />
            )}
            {job.property_stories && (
              <InfoRow icon={Layers} label="Stories" value={String(job.property_stories)} />
            )}
            {job.damage_source && (
              <InfoRow icon={Droplets} label="Damage Source" value={job.damage_source} />
            )}
            {job.affected_areas && (
              <InfoRow icon={MapPin} label="Affected Areas" value={job.affected_areas} />
            )}
            {job.access_notes && (
              <InfoRow icon={KeyRound} label="Access Notes" value={job.access_notes} />
            )}
            <InfoRow
              icon={FileText}
              label="Intake Date"
              value={format(new Date(job.created_at), "MMM d, yyyy 'at' h:mm a")}
            />
          </div>
        </div>

        {/* Contact & Insurance */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-[#1A1A1A] mb-4">
            Contact & Insurance
          </h3>
          <div className="space-y-3 text-sm">
            <InfoRow icon={User} label="Contact" value={contactName} />
            {job.contact?.phone && (
              <InfoRow icon={Phone} label="Phone" value={job.contact.phone} />
            )}
            {job.contact?.email && (
              <InfoRow icon={Mail} label="Email" value={job.contact.email} />
            )}
            {job.contact?.role && (
              <InfoRow
                icon={User}
                label="Relationship"
                value={job.contact.role.replace("_", " ")}
              />
            )}

            {(job.insurance_company || job.claim_number) && (
              <>
                <div className="border-t border-gray-100 pt-3 mt-3" />
                {job.insurance_company && (
                  <InfoRow
                    icon={Building}
                    label="Insurance"
                    value={job.insurance_company}
                  />
                )}
                {job.claim_number && (
                  <InfoRow
                    icon={FileText}
                    label="Claim #"
                    value={job.claim_number}
                  />
                )}
              </>
            )}

            {job.adjuster && (
              <>
                <div className="border-t border-gray-100 pt-3 mt-3" />
                <InfoRow
                  icon={User}
                  label="Adjuster"
                  value={`${job.adjuster.first_name} ${job.adjuster.last_name}`}
                />
                {job.adjuster.phone && (
                  <InfoRow
                    icon={Phone}
                    label="Adjuster Phone"
                    value={job.adjuster.phone}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Billing card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#1A1A1A]">Billing</h3>
          <button
            onClick={() => setPaymentModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[#1B2434] hover:bg-[#2a3a52] text-white transition-colors"
          >
            + Record Payment
          </button>
        </div>
        <RecordPaymentModal
          open={paymentModalOpen}
          onOpenChange={setPaymentModalOpen}
          jobId={jobId}
          onPaymentAdded={fetchData}
        />
        {payments.length === 0 ? (
          <p className="text-sm text-[#999999] text-center py-4">
            No payments recorded yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#666666]">Total Collected</span>
                <span className="font-semibold text-[#1A1A1A]">
                  ${totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
              {totalPaid > 0 && (
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
                  {insurancePaid > 0 && (
                    <div
                      className="bg-[#0F6E56] h-full"
                      style={{
                        width: `${(insurancePaid / totalPaid) * 100}%`,
                      }}
                    />
                  )}
                  {homeownerPaid > 0 && (
                    <div
                      className="bg-[#2B5EA7] h-full"
                      style={{
                        width: `${(homeownerPaid / totalPaid) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
              <div className="flex gap-4 text-xs text-[#999999]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#0F6E56]" />
                  Insurance: ${insurancePaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#2B5EA7]" />
                  Homeowner: ${homeownerPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Payment rows */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        "text-[10px] px-1.5 py-0 rounded",
                        p.source === "insurance"
                          ? "bg-[#E1F5EE] text-[#085041]"
                          : p.source === "homeowner"
                          ? "bg-[#E6F1FB] text-[#0C447C]"
                          : "bg-[#F1EFE8] text-[#5F5E5A]"
                      )}
                    >
                      {p.source}
                    </Badge>
                    <span className="text-[#666666]">
                      {p.method.replace("_", " ")}
                      {p.reference_number && ` — ${p.reference_number}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#1A1A1A]">
                      ${Number(p.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                    <Badge
                      className={cn(
                        "text-[10px] px-1.5 py-0 rounded",
                        p.status === "received"
                          ? "bg-[#E1F5EE] text-[#085041]"
                          : p.status === "pending"
                          ? "bg-[#FAEEDA] text-[#633806]"
                          : "bg-[#FCEBEB] text-[#791F1F]"
                      )}
                    >
                      {p.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Photos */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#1A1A1A]">
            <Camera size={16} className="inline mr-2 -mt-0.5" />
            Photos ({photos.length})
          </h3>
          <div className="flex gap-2">
            {photos.length > 0 && (
              <Link
                href={`/reports/new?jobId=${jobId}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-[#2B5EA7] hover:bg-[#E8F0FE] transition-colors gap-1.5"
              >
                <FileText size={14} />
                Generate Report
              </Link>
            )}
            <button
              onClick={() => setPhotoUploadOpen(true)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[#1B2434] hover:bg-[#2a3a52] text-white transition-colors"
            >
              + Upload Photos
            </button>
          </div>
        </div>
        <PhotoUploadModal
          open={photoUploadOpen}
          onOpenChange={setPhotoUploadOpen}
          jobId={jobId}
          tags={tags}
          onPhotosAdded={fetchData}
        />
        {photos.length === 0 ? (
          <div className="text-center py-8">
            <ImageIcon size={40} className="mx-auto text-[#CCCCCC] mb-2" />
            <p className="text-sm text-[#999999]">No photos yet.</p>
            <p className="text-xs text-[#BBBBBB] mt-1">
              Upload photos using the button above.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative group text-left"
              >
                <img
                  src={`${supabaseUrl}/storage/v1/object/public/photos/${photo.annotated_path || photo.storage_path}`}
                  alt={photo.caption || "Job photo"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                {photo.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-xs text-white truncate">
                      {photo.caption}
                    </p>
                  </div>
                )}
                {photo.before_after_role && (
                  <Badge
                    className={cn(
                      "absolute top-2 left-2 text-[10px] px-1.5 py-0 rounded",
                      photo.before_after_role === "before"
                        ? "bg-[#FCEBEB] text-[#791F1F]"
                        : "bg-[#E1F5EE] text-[#085041]"
                    )}
                  >
                    {photo.before_after_role === "before" ? "Before" : "After"}
                  </Badge>
                )}
                {photo.annotated_path && (
                  <div className="absolute bottom-2 right-2 bg-black/60 rounded px-1.5 py-0.5 flex items-center gap-1">
                    <Pencil size={10} className="text-white" />
                    <span className="text-[10px] text-white font-medium">Edited</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <PhotoDetailModal
        open={!!selectedPhoto}
        onOpenChange={(open) => {
          if (!open) setSelectedPhoto(null);
        }}
        photo={selectedPhoto}
        allTags={tags}
        photoUrl={
          selectedPhoto
            ? `${supabaseUrl}/storage/v1/object/public/photos/${selectedPhoto.annotated_path || selectedPhoto.storage_path}`
            : ""
        }
        onUpdated={() => {
          setSelectedPhoto(null);
          fetchData();
        }}
        onAnnotate={(photo, url) => {
          setAnnotatorPhoto(photo);
          setAnnotatorUrl(url);
          setSelectedPhoto(null);
          setAnnotatorOpen(true);
        }}
      />
      <PhotoAnnotator
        open={annotatorOpen}
        onOpenChange={(val) => {
          setAnnotatorOpen(val);
          if (!val) {
            setAnnotatorPhoto(null);
            setAnnotatorUrl("");
          }
        }}
        photos={photos}
        initialPhotoIndex={photos.findIndex((p) => p.id === annotatorPhoto?.id)}
        onSaved={fetchData}
      />

      {/* Reports */}
      {reports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[#1A1A1A]">
              <FileText size={16} className="inline mr-2 -mt-0.5" />
              Reports ({reports.length})
            </h3>
            <Link
              href={`/reports/new?jobId=${jobId}`}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-[#2B5EA7] hover:bg-[#E8F0FE] transition-colors gap-1.5"
            >
              <FileText size={14} />
              New Report
            </Link>
          </div>
          <div className="space-y-2">
            {reports.map((report) => (
              <Link
                key={report.id}
                href={`/reports/${report.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      report.status === "generated"
                        ? "bg-[#0F6E56]/10"
                        : "bg-[#6C5CE7]/10"
                    )}
                  >
                    <FileText
                      size={14}
                      className={
                        report.status === "generated"
                          ? "text-[#0F6E56]"
                          : "text-[#6C5CE7]"
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">
                      {report.title}
                    </p>
                    <p className="text-xs text-[#999999]">
                      {format(new Date(report.report_date), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "text-[10px] px-1.5 py-0 rounded capitalize flex-shrink-0",
                    report.status === "generated"
                      ? "bg-[#E1F5EE] text-[#085041]"
                      : "bg-[#F3F0FF] text-[#5B4DB5]"
                  )}
                >
                  {report.status}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Emails */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#1A1A1A]">
            <Mail size={16} className="inline mr-2 -mt-0.5" />
            Emails ({emails.length})
          </h3>
          <button
            onClick={() => {
              const defaultTo = job.contact?.email || job.adjuster?.email || "";
              const defaultSubject = job.job_number ? `Re: ${job.job_number}` : "";
              setComposeDefaults({ to: defaultTo, subject: defaultSubject, replyToMessageId: "" });
              setComposeOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[#2B5EA7] hover:bg-[#234b87] text-white transition-colors gap-1.5"
          >
            <Send size={14} />
            Send Email
          </button>
        </div>
        <ComposeEmailModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          jobId={jobId}
          defaultTo={composeDefaults.to}
          defaultSubject={composeDefaults.subject}
          replyToMessageId={composeDefaults.replyToMessageId || undefined}
          onSent={fetchData}
        />
        {emails.length > 0 && (
          <div className="space-y-2">
            {emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                isExpanded={expandedEmailId === email.id}
                onToggle={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                onReply={() => {
                  const isSent = email.folder === "sent" || email.folder === "drafts";
                  const replyTo = isSent ? (email.to_addresses?.[0]?.email || "") : email.from_address;
                  const replySubject = email.subject.startsWith("Re:") ? email.subject : "Re: " + email.subject;
                  setComposeDefaults({ to: replyTo, subject: replySubject, replyToMessageId: email.message_id });
                  setComposeOpen(true);
                }}
              />
            ))}
          </div>
        )}
        {emails.length === 0 && (
          <div className="text-center py-6">
            <Mail size={32} className="mx-auto text-[#CCCCCC] mb-2" />
            <p className="text-sm text-[#999999]">No emails linked to this job yet.</p>
            <p className="text-xs text-[#BBBBBB] mt-1">
              Sync your email or send one using the button above.
            </p>
          </div>
        )}
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">Custom Fields</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {customFields.map((cf) => (
              <div key={cf.field_key}>
                <p className="text-xs font-medium text-[#999999] capitalize">
                  {cf.field_key.replace(/_/g, " ").replace(/^custom /, "")}
                </p>
                <p className="text-sm text-[#1A1A1A]">{cf.field_value || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Timeline */}
      <ActivityTimeline
        activities={activities}
        jobId={jobId}
        onActivityAdded={fetchData}
      />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} className="text-[#999999] flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-[#999999]">{label}</p>
        <p className="text-[#1A1A1A]">{value}</p>
      </div>
    </div>
  );
}

function EmailRow({
  email,
  isExpanded,
  onToggle,
  onReply,
}: {
  email: Email;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: () => void;
}) {
  const isSent = email.folder === "sent" || email.folder === "drafts";
  const toLine = (email.to_addresses || []).map((a) => a.name || a.email).join(", ");

  const directionIcon = isSent
    ? <Send size={14} className="text-[#0F6E56]" />
    : <Inbox size={14} className="text-[#2B5EA7]" />;

  const iconBg = isSent ? "bg-[#0F6E56]/10" : "bg-[#2B5EA7]/10";
  const folderBadge = isSent ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#E6F1FB] text-[#0C447C]";

  const fromDisplay = isSent
    ? "To: " + toLine
    : "From: " + (email.from_name || email.from_address);

  const fullFrom = email.from_name
    ? email.from_name + " (" + email.from_address + ")"
    : email.from_address;

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 hover:bg-gray-50/50 transition-colors text-left"
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", iconBg)}>
          {directionIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-medium text-[#1A1A1A] truncate", !email.is_read && "font-bold")}>
              {email.subject || "(No Subject)"}
            </p>
            <Badge className={cn("text-[10px] px-1.5 py-0 rounded flex-shrink-0", folderBadge)}>
              {email.folder}
            </Badge>
            {email.matched_by && (
              <Badge className="text-[10px] px-1.5 py-0 rounded bg-gray-100 text-[#666] flex-shrink-0">
                {email.matched_by}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-[#666666] truncate">{fromDisplay}</p>
            <span className="text-xs text-[#999999] flex items-center gap-1 flex-shrink-0">
              <Clock size={10} />
              {format(new Date(email.received_at), "MMM d, h:mm a")}
            </span>
          </div>
          {!isExpanded && email.snippet && (
            <p className="text-xs text-[#999999] mt-1 line-clamp-1">{email.snippet}</p>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-100">
          <div className="mt-3 text-xs text-[#666666] space-y-1 mb-3">
            <p><span className="font-medium text-[#333]">From:</span> {fullFrom}</p>
            <p><span className="font-medium text-[#333]">To:</span> {toLine}</p>
            <p><span className="font-medium text-[#333]">Date:</span> {format(new Date(email.received_at), "EEEE, MMM d, yyyy 'at' h:mm a")}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-[#333] whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
            {email.body_text || email.snippet || "(No content)"}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onReply(); }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#2B5EA7] hover:underline"
          >
            <Send size={12} /> Reply
          </button>
        </div>
      )}
    </div>
  );
}
