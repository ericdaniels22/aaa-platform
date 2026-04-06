import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MapPin, User, Shield, Calendar } from "lucide-react";
import { format } from "date-fns";
import { Job } from "@/lib/types";
import {
  statusColors,
  statusLabels,
  urgencyColors,
  urgencyLabels,
  damageTypeColors,
  damageTypeLabels,
} from "@/lib/badge-colors";
import { cn } from "@/lib/utils";

export default function JobCard({ job }: { job: Job }) {
  const isCompleted = job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact
    ? `${job.contact.first_name} ${job.contact.last_name}`
    : "Unknown";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "block bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all",
        isCompleted && "opacity-60"
      )}
    >
      {/* Top row: job number + badges */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-mono text-[#999999]">{job.job_number}</p>
          <p className="text-base font-semibold text-[#1A1A1A] mt-0.5">
            {contactName}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-md",
              urgencyColors[job.urgency]
            )}
          >
            {urgencyLabels[job.urgency]}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-md",
              damageTypeColors[job.damage_type]
            )}
          >
            {damageTypeLabels[job.damage_type]}
          </Badge>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1.5 text-sm text-[#666666]">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="flex-shrink-0" />
          <span className="truncate">{job.property_address}</span>
        </div>
        <div className="flex items-center gap-2">
          <User size={14} className="flex-shrink-0" />
          <span>{contactName}</span>
        </div>
        {job.insurance_company && (
          <div className="flex items-center gap-2">
            <Shield size={14} className="flex-shrink-0" />
            <span>
              {job.insurance_company}
              {job.claim_number && ` — ${job.claim_number}`}
            </span>
          </div>
        )}
      </div>

      {/* Bottom row: date + status */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-xs text-[#999999]">
          <Calendar size={12} />
          <span>{format(new Date(job.created_at), "MMM d, yyyy")}</span>
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "text-[11px] font-medium px-2 py-0.5 rounded-md",
            statusColors[job.status]
          )}
        >
          {statusLabels[job.status]}
        </Badge>
      </div>
    </Link>
  );
}
