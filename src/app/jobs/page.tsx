"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Job } from "@/lib/types";
import JobCard from "@/components/job-card";
import { Briefcase, FileText, CalendarDays, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/config-context";

export default function JobsPage() {
  const { statuses } = useConfig();

  const filterOptions = [
    { value: "all", label: "All" },
    { value: "emergency", label: "Emergency" },
    ...statuses
      .filter((s) => !["new", "cancelled"].includes(s.name))
      .map((s) => ({ value: s.name, label: s.display_label })),
  ];
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
    <div className="max-w-6xl animate-fade-slide-up">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-foreground">
          <span className="gradient-text">Jobs</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          Track and manage all your jobs.
        </p>
      </div>

      {/* Stat cards — gradient hero style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          gradient="gradient-primary"
        />
        <StatCard
          label="Emergencies"
          value={stats.emergency}
          icon={Flame}
          gradient="gradient-accent"
        />
        <StatCard
          label="Pending Invoice"
          value={stats.pendingInvoice}
          icon={FileText}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
        />
        <StatCard
          label="This Month"
          value={stats.thisMonth}
          icon={CalendarDays}
          gradient="gradient-secondary"
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
                ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground/60">Loading jobs...</div>
      ) : sortedJobs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">No jobs found</p>
          <p className="text-muted-foreground/60 text-sm mt-1">
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
  gradient,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
}) {
  return (
    <div
      className={`rounded-xl p-5 text-white shadow-lg ${gradient}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-white/70 uppercase tracking-wider">
            {label}
          </p>
          <p className="text-3xl font-extrabold mt-1">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}
