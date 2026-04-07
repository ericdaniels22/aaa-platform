"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { PhotoReport, Job, Photo, PhotoReportTemplate } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  FileText,
  RefreshCw,
  Calendar,
  MapPin,
  Shield,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";
import { toast } from "sonner";
import { generateReportPDF } from "@/lib/generate-report-pdf";

interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

type ReportWithJob = PhotoReport & {
  job: Pick<Job, "id" | "job_number" | "property_address" | "claim_number" | "insurance_company">;
};

export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.id as string;

  const [report, setReport] = useState<ReportWithJob | null>(null);
  const [template, setTemplate] = useState<PhotoReportTemplate | null>(null);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const fetchReport = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("photo_reports")
      .select("*, job:jobs!job_id(id, job_number, property_address, claim_number, insurance_company)")
      .eq("id", reportId)
      .single();

    if (error || !data) {
      setLoading(false);
      return;
    }

    const rpt = data as ReportWithJob;
    setReport(rpt);

    // Fetch template if linked
    if (rpt.template_id) {
      const { data: tmpl } = await supabase
        .from("photo_report_templates")
        .select("*")
        .eq("id", rpt.template_id)
        .single();
      if (tmpl) setTemplate(tmpl as PhotoReportTemplate);
    }

    // Collect all photo IDs from sections and fetch them
    const sections = rpt.sections as ReportSection[];
    const allIds = new Set<string>();
    sections.forEach((s) => s.photo_ids.forEach((id) => allIds.add(id)));

    if (allIds.size > 0) {
      const { data: photoData } = await supabase
        .from("photos")
        .select("*")
        .in("id", Array.from(allIds));

      if (photoData) {
        const lookup: Record<string, Photo> = {};
        photoData.forEach((p) => {
          lookup[p.id] = p as Photo;
        });
        setPhotos(lookup);
      }
    }

    setLoading(false);
  }, [reportId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateReportPDF(reportId);
      toast.success("PDF generated successfully");
      fetchReport();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate PDF");
    }
    setGenerating(false);
  }

  function getPublicUrl(storagePath: string) {
    return `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;
  }

  if (loading) {
    return <div className="text-center py-12 text-[#999999]">Loading report...</div>;
  }

  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-[#999999]">Report not found.</p>
        <Link href="/reports" className="text-sm text-[#2B5EA7] hover:underline mt-2 inline-block">
          Back to Reports
        </Link>
      </div>
    );
  }

  const sections = report.sections as ReportSection[];
  const totalPhotos = sections.reduce((sum, s) => sum + s.photo_ids.length, 0);

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <Link
            href="/reports"
            className="text-[#999999] hover:text-[#1A1A1A] transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">{report.title}</h1>
            <div className="flex items-center gap-3 mt-1">
              <Link
                href={`/jobs/${report.job_id}`}
                className="text-sm text-[#2B5EA7] font-mono hover:underline"
              >
                {report.job?.job_number}
              </Link>
              <span className="text-sm text-[#999999]">
                {report.job?.property_address}
              </span>
              <Badge
                className={cn(
                  "text-[10px] px-1.5 py-0 rounded capitalize",
                  report.status === "generated"
                    ? "bg-[#E1F5EE] text-[#085041]"
                    : "bg-[#F3F0FF] text-[#5B4DB5]"
                )}
              >
                {report.status}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {report.status === "generated" && report.pdf_path && (
            <a
              href={`${supabaseUrl}/storage/v1/object/public/reports/${report.pdf_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[#0F6E56] text-white hover:bg-[#0B5A45] transition-colors"
            >
              <Download size={16} />
              Download PDF
            </a>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
              report.status === "draft"
                ? "bg-[#2B5EA7] text-white hover:bg-[#244d8a]"
                : "border border-gray-200 bg-white text-[#666666] hover:bg-gray-50"
            )}
          >
            {report.status === "draft" ? (
              <FileText size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            {generating
              ? "Generating..."
              : report.status === "draft"
              ? "Generate PDF"
              : "Regenerate PDF"}
          </button>
        </div>
      </div>

      {/* Report info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[#999999]" />
            <span className="text-xs text-[#999999]">Report Date</span>
          </div>
          <p className="text-sm font-semibold text-[#1A1A1A] mt-1">
            {format(new Date(report.report_date), "MMM d, yyyy")}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <ImageIcon size={14} className="text-[#999999]" />
            <span className="text-xs text-[#999999]">Total Photos</span>
          </div>
          <p className="text-sm font-semibold text-[#1A1A1A] mt-1">
            {totalPhotos}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[#999999]" />
            <span className="text-xs text-[#999999]">Sections</span>
          </div>
          <p className="text-sm font-semibold text-[#1A1A1A] mt-1">
            {sections.length}
          </p>
        </div>
        {template && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-[#999999]" />
              <span className="text-xs text-[#999999]">Template</span>
            </div>
            <p className="text-sm font-semibold text-[#1A1A1A] mt-1 truncate">
              {template.name}
            </p>
          </div>
        )}
        {report.job?.claim_number && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-[#999999]" />
              <span className="text-xs text-[#999999]">Claim #</span>
            </div>
            <p className="text-sm font-semibold text-[#1A1A1A] mt-1">
              {report.job.claim_number}
            </p>
          </div>
        )}
      </div>

      {/* Section preview */}
      <div className="space-y-4">
        {sections.map((section, si) => {
          const sectionPhotos = section.photo_ids
            .map((id) => photos[id])
            .filter(Boolean);

          return (
            <div
              key={si}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              {/* Section header */}
              <div className="bg-[#1B2434] px-5 py-3">
                <h3 className="text-sm font-semibold text-white">
                  {si + 1}. {section.title}
                </h3>
                {section.description && (
                  <p className="text-xs text-white/60 mt-0.5">
                    {section.description}
                  </p>
                )}
              </div>

              {/* Photo grid */}
              <div className="p-4">
                {sectionPhotos.length === 0 ? (
                  <p className="text-sm text-[#BBBBBB] text-center py-4">
                    No photos in this section
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {sectionPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        className="aspect-square rounded-lg overflow-hidden relative bg-gray-100"
                      >
                        <img
                          src={getPublicUrl(
                            photo.annotated_path || photo.storage_path
                          )}
                          alt={photo.caption || "Photo"}
                          className="w-full h-full object-cover"
                        />
                        {photo.caption && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                            <p className="text-[10px] text-white truncate">
                              {photo.caption}
                            </p>
                          </div>
                        )}
                        {photo.before_after_role && (
                          <Badge
                            className={cn(
                              "absolute top-1.5 left-1.5 text-[8px] px-1 py-0 rounded",
                              photo.before_after_role === "before"
                                ? "bg-[#FCEBEB] text-[#791F1F]"
                                : "bg-[#E1F5EE] text-[#085041]"
                            )}
                          >
                            {photo.before_after_role === "before"
                              ? "Before"
                              : "After"}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
