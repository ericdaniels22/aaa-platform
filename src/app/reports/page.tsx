"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { PhotoReport, Job } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Search,
  Plus,
  Calendar,
  Download,
  Layers,
  FileCheck,
  FileClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";
import { toast } from "sonner";
import { generateReportPDF } from "@/lib/generate-report-pdf";

type ReportWithJob = PhotoReport & {
  job: Pick<Job, "id" | "job_number" | "property_address">;
};

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const fetchReports = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("photo_reports")
      .select("*, job:jobs!job_id(id, job_number, property_address)")
      .order("created_at", { ascending: false });

    if (data) setReports(data as ReportWithJob[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const filtered = reports.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchTitle = r.title?.toLowerCase().includes(q);
      const matchJob = r.job?.job_number?.toLowerCase().includes(q);
      const matchAddress = r.job?.property_address?.toLowerCase().includes(q);
      if (!matchTitle && !matchJob && !matchAddress) return false;
    }
    return true;
  });

  async function handleGeneratePDF(reportId: string) {
    setGeneratingId(reportId);
    try {
      await generateReportPDF(reportId);
      toast.success("PDF generated successfully");
      fetchReports();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate PDF");
      console.error(err);
    }
    setGeneratingId(null);
  }

  const totalReports = reports.length;
  const drafts = reports.filter((r) => r.status === "draft").length;
  const generated = reports.filter((r) => r.status === "generated").length;

  if (loading) {
    return (
      <div className="text-center py-12 text-[#999999]">
        Loading reports...
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Photo Reports</h1>
          <p className="text-sm text-[#999999] mt-1">
            {totalReports} report{totalReports !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/reports/templates"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-[#1A1A1A] hover:bg-gray-50 transition-colors"
          >
            <Layers size={16} />
            Templates
          </Link>
          <Link
            href="/reports/new"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[#2B5EA7] text-white hover:bg-[#244d8a] transition-colors"
          >
            <Plus size={16} />
            New Report
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard
          label="Total Reports"
          value={totalReports}
          icon={FileText}
          color="bg-[#2B5EA7]"
        />
        <StatCard
          label="Generated"
          value={generated}
          icon={FileCheck}
          color="bg-[#0F6E56]"
        />
        <StatCard
          label="Drafts"
          value={drafts}
          icon={FileClock}
          color="bg-[#6C5CE7]"
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999999]"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, job number, or address..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            {["all", "draft", "generated"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s === "all" ? null : s)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium border transition-all capitalize",
                  (s === "all" && !statusFilter) || statusFilter === s
                    ? "bg-[#1B2434] text-white border-[#1B2434]"
                    : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Reports list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-[#CCCCCC] mb-3" />
          <p className="text-[#999999] text-lg font-medium">No reports yet</p>
          <p className="text-[#BBBBBB] text-sm mt-1">
            Generate a photo report from any job&apos;s Photos tab.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((report) => (
            <div
              key={report.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                      report.status === "generated"
                        ? "bg-[#0F6E56]/10"
                        : "bg-[#6C5CE7]/10"
                    )}
                  >
                    {report.status === "generated" ? (
                      <FileCheck size={20} className="text-[#0F6E56]" />
                    ) : (
                      <FileClock size={20} className="text-[#6C5CE7]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate">
                      <Link
                        href={`/reports/${report.id}`}
                        className="text-[#1A1A1A] hover:text-[#2B5EA7] transition-colors"
                      >
                        {report.title}
                      </Link>
                    </h3>
                    <Link
                      href={`/jobs/${report.job_id}`}
                      className="text-xs text-[#2B5EA7] font-mono hover:underline"
                    >
                      {report.job?.job_number}
                    </Link>
                    <span className="text-xs text-[#999999] ml-2">
                      {report.job?.property_address}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
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
                      <span className="text-xs text-[#BBBBBB] flex items-center gap-1">
                        <Calendar size={10} />
                        {format(new Date(report.report_date), "MMM d, yyyy")}
                      </span>
                      <span className="text-xs text-[#BBBBBB]">
                        {(report.sections as unknown[])?.length || 0} section
                        {(report.sections as unknown[])?.length !== 1
                          ? "s"
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {report.status === "generated" && report.pdf_path && (
                    <a
                      href={`${supabaseUrl}/storage/v1/object/public/reports/${report.pdf_path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0F6E56] text-white hover:bg-[#0B5A45] transition-colors"
                    >
                      <Download size={14} />
                      PDF
                    </a>
                  )}
                  <button
                    onClick={() => handleGeneratePDF(report.id)}
                    disabled={generatingId === report.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50",
                      report.status === "draft"
                        ? "bg-[#2B5EA7] text-white hover:bg-[#244d8a]"
                        : "border border-gray-200 bg-white text-[#666666] hover:bg-gray-50"
                    )}
                  >
                    <FileText size={14} />
                    {generatingId === report.id
                      ? "Generating..."
                      : report.status === "draft"
                      ? "Generate PDF"
                      : "Regenerate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            color
          )}
        >
          <Icon size={18} className="text-white" />
        </div>
        <div>
          <p className="text-xl font-bold text-[#1A1A1A]">{value}</p>
          <p className="text-xs text-[#999999]">{label}</p>
        </div>
      </div>
    </div>
  );
}
