"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Job, JobActivity, Payment, Photo, PhotoTag, PhotoReport, Email } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import ActivityTimeline from "@/components/activity-timeline";
import RecordPaymentModal from "@/components/record-payment";
import PhotoUploadModal from "@/components/photo-upload";
import PhotoDetailModal from "@/components/photo-detail";
import PhotoAnnotator from "@/components/photo-annotator";
import ComposeEmailModal from "@/components/compose-email";
import JarvisJobPanel from "@/components/jarvis/JarvisJobPanel";
import JobFiles from "@/components/job-files";
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
  Loader2,
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
  const [editJobOpen, setEditJobOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);

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
      <div className="text-center py-12 text-muted-foreground/60">Loading job...</div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">Job not found.</p>
        <Link href="/jobs" className="text-primary text-sm hover:underline mt-2 inline-block">
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
    <div className="max-w-6xl animate-fade-slide-up">
      {/* Back link */}
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={16} />
        Back to Jobs
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-sm font-mono text-muted-foreground/60">{job.job_number}</p>
          <h1 className="text-2xl font-bold text-foreground">{contactName}</h1>
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
          <JarvisJobPanel
            jobId={jobId}
            jobContext={{
              customerName: contactName,
              address: job.property_address,
              status: job.status,
              damageType: job.damage_type,
            }}
          />
          <select
            value={job.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
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
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              Job Info
            </h3>
            <button
              onClick={() => setEditJobOpen(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Edit Job Info"
            >
              <Pencil size={14} />
            </button>
          </div>
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
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              Contact & Insurance
            </h3>
            <button
              onClick={() => setEditContactOpen(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Edit Contact & Insurance"
            >
              <Pencil size={14} />
            </button>
          </div>
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
                <div className="border-t border-border/50 pt-3 mt-3" />
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
                <div className="border-t border-border/50 pt-3 mt-3" />
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

      {/* Edit Job Info Dialog */}
      <EditJobInfoDialog
        open={editJobOpen}
        onOpenChange={setEditJobOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />

      {/* Edit Contact & Insurance Dialog */}
      <EditContactDialog
        open={editContactOpen}
        onOpenChange={setEditContactOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />

      {/* Billing card */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Billing</h3>
          <button
            onClick={() => setPaymentModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-colors"
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
          <p className="text-sm text-muted-foreground/60 text-center py-4">
            No payments recorded yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Collected</span>
                <span className="font-semibold text-foreground">
                  ${totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
              {totalPaid > 0 && (
                <div className="h-3 bg-muted rounded-full overflow-hidden flex">
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
              <div className="flex gap-4 text-xs text-muted-foreground/60">
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
            <div className="border-t border-border/50 pt-3 space-y-2">
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
                    <span className="text-muted-foreground">
                      {p.method.replace("_", " ")}
                      {p.reference_number && ` — ${p.reference_number}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
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
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">
            <Camera size={16} className="inline mr-2 -mt-0.5" />
            Photos ({photos.length})
          </h3>
          <div className="flex gap-2">
            {photos.length > 0 && (
              <Link
                href={`/reports/new?jobId=${jobId}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-primary hover:bg-[#E8F0FE] transition-colors gap-1.5"
              >
                <FileText size={14} />
                Generate Report
              </Link>
            )}
            <button
              onClick={() => setPhotoUploadOpen(true)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-colors"
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
            <ImageIcon size={40} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground/60">No photos yet.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              Upload photos using the button above.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className="aspect-square bg-muted rounded-lg overflow-hidden relative group text-left"
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

      <JobFiles jobId={jobId} />

      {/* Reports */}
      {reports.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              <FileText size={16} className="inline mr-2 -mt-0.5" />
              Reports ({reports.length})
            </h3>
            <Link
              href={`/reports/new?jobId=${jobId}`}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-primary hover:bg-[#E8F0FE] transition-colors gap-1.5"
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
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/50 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      report.status === "generated"
                        ? "bg-primary/10"
                        : "bg-vibrant-purple/10"
                    )}
                  >
                    <FileText
                      size={14}
                      className={
                        report.status === "generated"
                          ? "text-primary"
                          : "text-vibrant-purple"
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {report.title}
                    </p>
                    <p className="text-xs text-muted-foreground/60">
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
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">
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
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-colors gap-1.5"
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
            <Mail size={32} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground/60">No emails linked to this job yet.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              Sync your email or send one using the button above.
            </p>
          </div>
        )}
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Custom Fields</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {customFields.map((cf) => (
              <div key={cf.field_key}>
                <p className="text-xs font-medium text-muted-foreground/60 capitalize">
                  {cf.field_key.replace(/_/g, " ").replace(/^custom /, "")}
                </p>
                <p className="text-sm text-foreground">{cf.field_value || "—"}</p>
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
      <Icon size={16} className="text-primary/60 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-foreground">{value}</p>
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
    ? <Send size={14} className="text-primary" />
    : <Inbox size={14} className="text-primary" />;

  const iconBg = isSent ? "bg-primary/10" : "bg-vibrant-blue/10";
  const folderBadge = isSent ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#E6F1FB] text-[#0C447C]";

  const fromDisplay = isSent
    ? "To: " + toLine
    : "From: " + (email.from_name || email.from_address);

  const fullFrom = email.from_name
    ? email.from_name + " (" + email.from_address + ")"
    : email.from_address;

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 hover:bg-accent/50 transition-colors text-left"
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", iconBg)}>
          {directionIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-medium text-foreground truncate", !email.is_read && "font-bold")}>
              {email.subject || "(No Subject)"}
            </p>
            <Badge className={cn("text-[10px] px-1.5 py-0 rounded flex-shrink-0", folderBadge)}>
              {email.folder}
            </Badge>
            {email.matched_by && (
              <Badge className="text-[10px] px-1.5 py-0 rounded bg-muted text-[#666] flex-shrink-0">
                {email.matched_by}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground truncate">{fromDisplay}</p>
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1 flex-shrink-0">
              <Clock size={10} />
              {format(new Date(email.received_at), "MMM d, h:mm a")}
            </span>
          </div>
          {!isExpanded && email.snippet && (
            <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-1">{email.snippet}</p>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/50">
          <div className="mt-3 text-xs text-muted-foreground space-y-1 mb-3">
            <p><span className="font-medium text-foreground/80">From:</span> {fullFrom}</p>
            <p><span className="font-medium text-foreground/80">To:</span> {toLine}</p>
            <p><span className="font-medium text-foreground/80">Date:</span> {format(new Date(email.received_at), "EEEE, MMM d, yyyy 'at' h:mm a")}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
            {email.body_text || email.snippet || "(No content)"}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onReply(); }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Send size={12} /> Reply
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Edit Job Info Dialog ── */

function EditJobInfoDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    property_address: "",
    property_type: "" as string,
    property_sqft: "" as string,
    property_stories: "" as string,
    damage_source: "",
    affected_areas: "",
    access_notes: "",
    insurance_company: "",
    claim_number: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        property_address: job.property_address || "",
        property_type: job.property_type || "",
        property_sqft: job.property_sqft ? String(job.property_sqft) : "",
        property_stories: job.property_stories ? String(job.property_stories) : "",
        damage_source: job.damage_source || "",
        affected_areas: job.affected_areas || "",
        access_notes: job.access_notes || "",
        insurance_company: job.insurance_company || "",
        claim_number: job.claim_number || "",
      });
    }
  }, [open, job]);

  async function handleSave() {
    if (!form.property_address.trim()) {
      toast.error("Address is required.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({
        property_address: form.property_address.trim(),
        property_type: form.property_type || null,
        property_sqft: form.property_sqft ? Number(form.property_sqft) : null,
        property_stories: form.property_stories ? Number(form.property_stories) : null,
        damage_source: form.damage_source.trim() || null,
        affected_areas: form.affected_areas.trim() || null,
        access_notes: form.access_notes.trim() || null,
        insurance_company: form.insurance_company.trim() || null,
        claim_number: form.claim_number.trim() || null,
      })
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to update job info.");
    } else {
      toast.success("Job info updated.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Job Info</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Address *</label>
            <Input value={form.property_address} onChange={(e) => update("property_address", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Property Type</label>
              <select
                value={form.property_type}
                onChange={(e) => update("property_type", e.target.value)}
                className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
              >
                <option value="">Select...</option>
                <option value="single_family">Single Family</option>
                <option value="multi_family">Multi Family</option>
                <option value="commercial">Commercial</option>
                <option value="condo">Condo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Sq Ft</label>
              <Input type="number" value={form.property_sqft} onChange={(e) => update("property_sqft", e.target.value)} placeholder="e.g. 2400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Stories</label>
              <Input type="number" value={form.property_stories} onChange={(e) => update("property_stories", e.target.value)} placeholder="e.g. 2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Damage Source</label>
              <Input value={form.damage_source} onChange={(e) => update("damage_source", e.target.value)} placeholder="e.g. Burst pipe" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Affected Areas</label>
            <Input value={form.affected_areas} onChange={(e) => update("affected_areas", e.target.value)} placeholder="e.g. Kitchen, hallway" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Access Notes</label>
            <Textarea value={form.access_notes} onChange={(e) => update("access_notes", e.target.value)} rows={2} placeholder="Gate code, lockbox, etc." />
          </div>
          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Insurance</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Insurance Company</label>
                <Input value={form.insurance_company} onChange={(e) => update("insurance_company", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Claim #</label>
                <Input value={form.claim_number} onChange={(e) => update("claim_number", e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Edit Contact Dialog ── */

function EditContactDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    role: "homeowner" as string,
  });

  useEffect(() => {
    if (open && job.contact) {
      setForm({
        first_name: job.contact.first_name || "",
        last_name: job.contact.last_name || "",
        phone: job.contact.phone || "",
        email: job.contact.email || "",
        role: job.contact.role || "homeowner",
      });
    }
  }, [open, job.contact]);

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    if (!job.contact_id) {
      toast.error("No contact linked to this job.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        role: form.role,
      })
      .eq("id", job.contact_id);

    if (error) {
      toast.error("Failed to update contact.");
    } else {
      toast.success("Contact updated.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (!job.contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">First Name *</label>
              <Input value={form.first_name} onChange={(e) => update("first_name", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Last Name *</label>
              <Input value={form.last_name} onChange={(e) => update("last_name", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Phone</label>
            <Input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="(512) 555-0101" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Email</label>
            <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="contact@email.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Role</label>
            <select
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
            >
              <option value="homeowner">Homeowner</option>
              <option value="tenant">Tenant</option>
              <option value="property_manager">Property Manager</option>
              <option value="adjuster">Adjuster</option>
              <option value="insurance">Insurance</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
