"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Job } from "@/lib/types";
import JobCard from "@/components/job-card";
import { Briefcase, FileText, CalendarDays, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

const filterOptions = [
  { value: "all", label: "All" },
  { value: "emergency", label: "Emergency" },
  { value: "in_progress", label: "In Progress" },
  { value: "pending_invoice", label: "Pending Invoice" },
  { value: "completed", label: "Completed" },
];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("jobs")
      .select("*, contact:contacts!contact_id(*)")
      .order("created_at", { ascending: false });

    if (filter === "emergency") {
      query = query.eq("urgency", "emergency");
    } else if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setJobs((data as Job[]) || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Compute stats from all jobs (not filtered)
  const [stats, setStats] = useState({
    active: 0,
    emergency: 0,
    pendingInvoice: 0,
    thisMonth: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      const supabase = createClient();
      const { data: allJobs } = await supabase
        .from("jobs")
        .select("status, urgency, created_at");

      if (!allJobs) return;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      setStats({
        active: allJobs.filter(
          (j) => j.status !== "completed" && j.status !== "cancelled"
        ).length,
        emergency: allJobs.filter(
          (j) =>
            j.urgency === "emergency" &&
            j.status !== "completed" &&
            j.status !== "cancelled"
        ).length,
        pendingInvoice: allJobs.filter(
          (j) => j.status === "pending_invoice"
        ).length,
        thisMonth: allJobs.filter(
          (j) => new Date(j.created_at) >= monthStart
        ).length,
      });
    }
    fetchStats();
  }, []);

  // Sort: emergencies first, then by date
  const sortedJobs = [...jobs].sort((a, b) => {
    if (a.urgency === "emergency" && b.urgency !== "emergency") return -1;
    if (b.urgency === "emergency" && a.urgency !== "emergency") return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Jobs</h1>
        <p className="text-[#666666] mt-1">
          Track and manage all your jobs.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          accent="border-l-[#0F6E56]"
        />
        <StatCard
          label="Emergencies"
          value={stats.emergency}
          icon={Flame}
          accent="border-l-[#C41E2A]"
        />
        <StatCard
          label="Pending Invoice"
          value={stats.pendingInvoice}
          icon={FileText}
          accent="border-l-[#6C5CE7]"
        />
        <StatCard
          label="This Month"
          value={stats.thisMonth}
          icon={CalendarDays}
          accent="border-l-[#2B5EA7]"
        />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setFilter(opt.value);
              setLoading(true);
            }}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
              filter === opt.value
                ? "bg-[#1B2434] text-white border-[#1B2434]"
                : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div className="text-center py-12 text-[#999999]">Loading jobs...</div>
      ) : sortedJobs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[#999999] text-lg">No jobs found</p>
          <p className="text-[#BBBBBB] text-sm mt-1">
            Create a new intake to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedJobs.map((job) => (
            <JobCard key={job.id} job={job} />
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
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-5 border-l-4 ${accent}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-[#999999] uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-[#1A1A1A] mt-1">{value}</p>
        </div>
        <Icon size={20} className="text-[#CCCCCC]" />
      </div>
    </div>
  );
}
