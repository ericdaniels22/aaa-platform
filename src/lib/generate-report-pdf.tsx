"use client";

import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase";
import ReportPDFDocument from "@/components/report-pdf-document";
import { PhotoReport, Photo, Job } from "@/lib/types";

interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

interface CoverPageConfig {
  show_logo: boolean;
  show_company: boolean;
  show_date: boolean;
  show_photo_count: boolean;
}

/**
 * Generate a PDF for a photo report, upload to Supabase storage,
 * and update the report record with the pdf_path and status.
 */
export async function generateReportPDF(reportId: string): Promise<string> {
  const supabase = createClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // 1. Fetch the report with its job
  const { data: report, error: reportErr } = await supabase
    .from("photo_reports")
    .select("*, job:jobs!job_id(id, job_number, property_address, claim_number, insurance_company)")
    .eq("id", reportId)
    .single();

  if (reportErr || !report) {
    throw new Error("Failed to fetch report");
  }

  const job = report.job as Pick<Job, "id" | "job_number" | "property_address" | "claim_number" | "insurance_company">;
  const sections = report.sections as ReportSection[];

  // 2. Fetch the template (for cover page config and photos_per_page)
  let coverPage: CoverPageConfig = {
    show_logo: true,
    show_company: true,
    show_date: true,
    show_photo_count: true,
  };
  let photosPerPage = 2;

  if (report.template_id) {
    const { data: template } = await supabase
      .from("photo_report_templates")
      .select("cover_page, photos_per_page")
      .eq("id", report.template_id)
      .single();

    if (template) {
      coverPage = template.cover_page as unknown as CoverPageConfig;
      photosPerPage = template.photos_per_page;
    }
  }

  // 3. Collect all photo IDs from sections
  const allPhotoIds = new Set<string>();
  sections.forEach((s) => s.photo_ids.forEach((id) => allPhotoIds.add(id)));

  // 4. Fetch the actual photos
  const { data: photoData } = await supabase
    .from("photos")
    .select("id, storage_path, annotated_path, caption, before_after_role, taken_at")
    .in("id", Array.from(allPhotoIds));

  // Build photo lookup with full URLs
  const photos: Record<
    string,
    {
      id: string;
      url: string;
      caption: string | null;
      before_after_role: "before" | "after" | null;
      taken_at: string | null;
    }
  > = {};

  for (const p of photoData || []) {
    const path = p.annotated_path || p.storage_path;
    photos[p.id] = {
      id: p.id,
      url: `${supabaseUrl}/storage/v1/object/public/photos/${path}`,
      caption: p.caption,
      before_after_role: p.before_after_role,
      taken_at: p.taken_at,
    };
  }

  // 5. Render PDF to blob
  const blob = await pdf(
    <ReportPDFDocument
      title={report.title}
      jobNumber={job.job_number}
      propertyAddress={job.property_address}
      claimNumber={job.claim_number}
      insuranceCompany={job.insurance_company}
      reportDate={report.report_date}
      sections={sections}
      photos={photos}
      photosPerPage={photosPerPage}
      coverPage={coverPage}
    />
  ).toBlob();

  // 6. Upload PDF to Supabase Storage
  const pdfPath = `${job.job_number}/${reportId}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from("reports")
    .upload(pdfPath, blob, {
      upsert: true,
      contentType: "application/pdf",
    });

  if (uploadErr) {
    throw new Error(`Failed to upload PDF: ${uploadErr.message}`);
  }

  // 7. Update report record
  const { error: updateErr } = await supabase
    .from("photo_reports")
    .update({
      pdf_path: pdfPath,
      status: "generated",
    })
    .eq("id", reportId);

  if (updateErr) {
    throw new Error(`Failed to update report: ${updateErr.message}`);
  }

  return pdfPath;
}
