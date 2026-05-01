import type { EstimateStatus } from "@/lib/types";

// Tailwind classes for the status badge in HeaderBar, the read-only
// /estimates/[id] view, and the job-page EstimatesInvoicesSection table.
// Add a new entry here whenever EstimateStatus gains a value.
export const STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  voided: "bg-destructive text-destructive-foreground",
};

// Capitalised status label, e.g. "draft" → "Draft".
export function formatStatusLabel(status: EstimateStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
