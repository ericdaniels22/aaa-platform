import { SupabaseClient } from "@supabase/supabase-js";

interface MatchResult {
  job_id: string;
  matched_by: "contact" | "claim_number" | "address" | "job_id";
}

interface JobRow {
  id: string;
  job_number: string;
  claim_number: string | null;
  property_address: string;
  contact_id: string;
  adjuster_contact_id: string | null;
}

interface ContactRow {
  id: string;
  email: string | null;
}

/**
 * Try to match an email to a job using multiple strategies.
 * Returns the first match found, or null if no match.
 *
 * Priority:
 * 1. Job number in subject (e.g. WTR-2026-0001)
 * 2. Contact email address match
 * 3. Claim number in subject or body
 * 4. Property address in subject or body
 */
export async function matchEmailToJob(
  supabase: SupabaseClient,
  email: { from_address: string; to_addresses: { email: string }[]; subject: string; body_text: string | null },
  accountEmail: string
): Promise<MatchResult | null> {
  // Fetch all active jobs with their contacts
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, job_number, claim_number, property_address, contact_id, adjuster_contact_id")
    .not("status", "eq", "cancelled");

  if (!jobs || jobs.length === 0) return null;

  const typedJobs = jobs as JobRow[];
  const searchText = `${email.subject} ${email.body_text || ""}`.toLowerCase();

  // 1. Match by job number in subject (most precise)
  const jobNumberMatch = typedJobs.find((job) => {
    return email.subject.toUpperCase().includes(job.job_number.toUpperCase());
  });
  if (jobNumberMatch) {
    return { job_id: jobNumberMatch.id, matched_by: "job_id" };
  }

  // 2. Match by contact email
  // Get all contact IDs referenced by jobs
  const contactIds = new Set<string>();
  for (const job of typedJobs) {
    contactIds.add(job.contact_id);
    if (job.adjuster_contact_id) contactIds.add(job.adjuster_contact_id);
  }

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email")
    .in("id", Array.from(contactIds))
    .not("email", "is", null);

  if (contacts && contacts.length > 0) {
    const typedContacts = contacts as ContactRow[];
    // Determine the "other party" email (the one that isn't our account)
    const firstTo = email.to_addresses?.[0]?.email || "";
    const otherEmail = email.from_address.toLowerCase() === accountEmail.toLowerCase()
      ? firstTo.toLowerCase()
      : email.from_address.toLowerCase();

    const matchedContact = typedContacts.find(
      (c) => c.email && c.email.toLowerCase() === otherEmail
    );

    if (matchedContact) {
      // Find the job this contact belongs to
      const job = typedJobs.find(
        (j) =>
          j.contact_id === matchedContact.id ||
          j.adjuster_contact_id === matchedContact.id
      );
      if (job) {
        return { job_id: job.id, matched_by: "contact" };
      }
    }
  }

  // 3. Match by claim number in subject or body
  const claimMatch = typedJobs.find((job) => {
    if (!job.claim_number) return false;
    return searchText.includes(job.claim_number.toLowerCase());
  });
  if (claimMatch) {
    return { job_id: claimMatch.id, matched_by: "claim_number" };
  }

  // 4. Match by property address in subject or body
  // Normalize addresses for fuzzy matching (remove common suffixes)
  const addressMatch = typedJobs.find((job) => {
    if (!job.property_address) return false;
    const normalizedAddress = normalizeAddress(job.property_address);
    return normalizedAddress.length > 5 && searchText.includes(normalizedAddress);
  });
  if (addressMatch) {
    return { job_id: addressMatch.id, matched_by: "address" };
  }

  return null;
}

function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|circle|cir|place|pl)\b\.?/g, "")
    .replace(/[,#.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
