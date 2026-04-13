interface MatchResult {
  job_id: string;
  matched_by: "contact" | "claim_number" | "address" | "job_id";
}

export interface JobRow {
  id: string;
  job_number: string;
  claim_number: string | null;
  property_address: string;
  contact_id: string;
  job_adjusters?: { contact_id: string }[];
}

export interface ContactRow {
  id: string;
  email: string | null;
}

export interface MatcherCache {
  jobs: JobRow[];
  contacts: ContactRow[];
}

/**
 * Try to match an email to a job using pre-loaded cache.
 * Returns the first match found, or null if no match.
 *
 * Priority:
 * 1. Job number in subject (e.g. WTR-2026-0001)
 * 2. Contact email address match
 * 3. Claim number in subject or body
 * 4. Property address in subject or body
 */
export function matchEmailToJob(
  cache: MatcherCache,
  email: { from_address: string; to_addresses: { email: string }[]; subject: string; body_text: string | null },
  accountEmail: string
): MatchResult | null {
  const { jobs, contacts } = cache;

  if (jobs.length === 0) return null;

  const searchText = `${email.subject} ${email.body_text || ""}`.toLowerCase();

  // 1. Match by job number in subject (most precise)
  const jobNumberMatch = jobs.find((job) => {
    return email.subject.toUpperCase().includes(job.job_number.toUpperCase());
  });
  if (jobNumberMatch) {
    return { job_id: jobNumberMatch.id, matched_by: "job_id" };
  }

  // 2. Match by contact email
  if (contacts.length > 0) {
    const firstTo = email.to_addresses?.[0]?.email || "";
    const otherEmail = email.from_address.toLowerCase() === accountEmail.toLowerCase()
      ? firstTo.toLowerCase()
      : email.from_address.toLowerCase();

    const matchedContact = contacts.find(
      (c) => c.email && c.email.toLowerCase() === otherEmail
    );

    if (matchedContact) {
      const job = jobs.find(
        (j) =>
          j.contact_id === matchedContact.id ||
          (j.job_adjusters || []).some((ja) => ja.contact_id === matchedContact.id)
      );
      if (job) {
        return { job_id: job.id, matched_by: "contact" };
      }
    }
  }

  // 3. Match by claim number in subject or body
  const claimMatch = jobs.find((job) => {
    if (!job.claim_number) return false;
    return searchText.includes(job.claim_number.toLowerCase());
  });
  if (claimMatch) {
    return { job_id: claimMatch.id, matched_by: "claim_number" };
  }

  // 4. Match by property address in subject or body
  const addressMatch = jobs.find((job) => {
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
