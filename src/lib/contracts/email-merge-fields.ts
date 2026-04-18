import { applyMergeFieldValues, buildMergeFieldValues } from "./merge-fields";
import type { SupabaseClient } from "@supabase/supabase-js";

// Email templates support the same merge fields as contract templates
// plus two extras that only make sense at email-send time.
export const EMAIL_EXTRA_MERGE_FIELDS = [
  { name: "signing_link", label: "Signing Link" },
  { name: "document_title", label: "Document Title" },
] as const;

export interface EmailMergeExtras {
  signing_link: string;
  document_title: string;
  // Optional extras the caller can slot in for specific template types
  // (e.g. link back to the internal contract view for staff emails).
  contract_platform_url?: string;
}

// Resolves contract + email-extra merge fields against a job. Returns
// both the subject and body with tokens replaced — subject is plain text
// (entities decoded) and body is HTML.
export async function resolveEmailTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  jobId: string,
  extras: EmailMergeExtras,
): Promise<{ subject: string; html: string; unresolvedFields: string[] }> {
  const values = await buildMergeFieldValues(supabase, jobId);
  const withExtras: Record<string, string | null> = {
    ...values,
    signing_link: extras.signing_link,
    document_title: extras.document_title,
    contract_platform_url: extras.contract_platform_url ?? null,
  };

  // Subject is text, not HTML. Apply the same resolver but then decode
  // &amp;/&lt; etc. that the HTML-escape step introduced.
  const subjResult = applyMergeFieldValues(subjectTemplate, withExtras);
  const subject = decodeHtmlEntities(subjResult.html);

  const bodyResult = applyMergeFieldValues(bodyTemplate, withExtras);

  const unresolved = Array.from(new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]));
  return { subject, html: bodyResult.html, unresolvedFields: unresolved };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
