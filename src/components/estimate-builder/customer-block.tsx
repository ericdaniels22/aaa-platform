"use client";

import { User } from "lucide-react";
import type { Contact, Job } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// CustomerBlock — read-only display of customer info pulled from the job.
// No "View customer" link is rendered because /contacts/[id] does not exist yet.
// TODO(post-67a): add View customer link when /contacts/[id] detail page exists
// ─────────────────────────────────────────────────────────────────────────────

interface CustomerBlockProps {
  job: Job & { contact: Contact | null };
}

export function CustomerBlock({ job }: CustomerBlockProps) {
  const { contact } = job;
  const customerName = contact
    ? `${contact.first_name} ${contact.last_name}`.trim()
    : "—";

  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <User size={14} className="text-muted-foreground" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Customer
        </span>
      </div>

      <div className="text-sm space-y-0.5">
        <div className="font-medium text-foreground">{customerName}</div>
        {job.property_address && (
          <div className="text-muted-foreground">{job.property_address}</div>
        )}
        {contact?.email && (
          <div className="text-muted-foreground">{contact.email}</div>
        )}
        {contact?.phone && (
          <div className="text-muted-foreground">{contact.phone}</div>
        )}
      </div>
    </div>
  );
}
