"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Briefcase, FileText, CalendarDays, Camera } from "lucide-react";
import Link from "next/link";
import { Job } from "@/lib/types";
import JobCard from "@/components/job-card";

export default function DashboardPage() {
  const [stats, setStats] = useState({ active: 0, pendingInvoice: 0, thisMonth: 0, reports: 0 });
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Fetch all jobs + report count for stats
      const [{ data: allJobs }, { count: reportCount }] = await Promise.all([
        supabase.from("jobs").select("status, urgency, created_at"),
        supabase.from("photo_reports").select("*", { count: "exact", head: true }),
      ]);

      if (allJobs) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        setStats({
          active: allJobs.filter(
            (j) => j.status !== "completed" && j.status !== "cancelled"
          ).length,
          pendingInvoice: allJobs.filter(
            (j) => j.status === "pending_invoice"
          ).length,
          thisMonth: allJobs.filter(
            (j) => new Date(j.created_at) >= monthStart
          ).length,
          reports: reportCount ?? 0,
        });
      }

      // Fetch 4 most recent jobs
      const { data: recent } = await supabase
        .from("jobs")
        .select("*, contact:contacts!contact_id(*)")
        .order("created_at", { ascending: false })
        .limit(4);

      if (recent) setRecentJobs(recent as Job[]);
    }
    load();
  }, []);

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, Eric. Here&apos;s your overview.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          accent="border-l-[#0F6E56]"
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
        <StatCard
          label="Reports"
          value={stats.reports}
          icon={Camera}
          accent="border-l-[#C41E2A]"
        />
      </div>

      {/* Recent jobs */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Jobs</h2>
        <Link
          href="/jobs"
          className="text-sm text-[#2B5EA7] hover:underline font-medium"
        >
          View all
        </Link>
      </div>
      {recentJobs.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <p className="text-muted-foreground">No jobs yet.</p>
          <Link
            href="/intake"
            className="text-sm text-[var(--brand-accent)] hover:underline font-medium mt-1 inline-block"
          >
            Create your first intake
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recentJobs.map((job) => (
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
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
}) {
  return (
    <div
      className={`bg-card rounded-xl border border-border p-5 border-l-4 ${accent}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        </div>
        <Icon size={20} className="text-muted-foreground/40" />
      </div>
    </div>
  );
}
