import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveMergeFields } from "@/lib/contracts/merge-fields";

// POST /api/contracts/preview
// Body: { templateId, jobId }
// Returns merge-field-resolved HTML + title + unresolved field names for
// the Send for Signature compose modal's Preview Contract action.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { templateId?: string; jobId?: string }
    | null;
  if (!body?.templateId || !body?.jobId) {
    return NextResponse.json(
      { error: "templateId and jobId are required" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: template, error: tErr } = await supabase
    .from("contract_templates")
    .select("id, name, content_html, version, is_active")
    .eq("id", body.templateId)
    .maybeSingle<{ id: string; name: string; content_html: string; version: number; is_active: boolean }>();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!template.is_active) {
    return NextResponse.json({ error: "Template is archived" }, { status: 400 });
  }

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .select("id, job_number, contact:contacts(first_name, last_name)")
    .eq("id", body.jobId)
    .maybeSingle<{ id: string; job_number: string | null; contact: { first_name: string | null; last_name: string | null } | null }>();
  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const resolved = await resolveMergeFields(supabase, template.content_html, job.id);
  const customerName = [job.contact?.first_name, job.contact?.last_name].filter(Boolean).join(" ").trim();
  const defaultTitle = `${template.name}${customerName ? ` — ${customerName}` : job.job_number ? ` — ${job.job_number}` : ""}`;

  return NextResponse.json({
    html: resolved.html,
    unresolvedFields: resolved.unresolvedFields,
    templateVersion: template.version,
    defaultTitle,
  });
}
