import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

// GET /api/jobs/[id]/contact-email
// Returns the linked contact's email + display name. Used by the payment
// request modal to prefill the Recipient field; callers may override.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "record_payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("contact_id")
    .eq("id", id)
    .maybeSingle<{ contact_id: string | null }>();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });

  if (!job.contact_id) {
    return NextResponse.json({ email: null, name: null });
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("email, first_name, last_name")
    .eq("id", job.contact_id)
    .maybeSingle<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }>();

  const email = contact?.email ?? null;
  const name =
    [contact?.first_name, contact?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

  return NextResponse.json({ email, name });
}
