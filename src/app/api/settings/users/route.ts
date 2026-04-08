import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";

const ALL_PERMISSIONS = [
  "view_jobs", "edit_jobs", "create_jobs",
  "log_activities", "upload_photos", "edit_photos",
  "view_billing", "record_payments",
  "view_email", "send_email",
  "manage_reports", "access_settings",
];

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  crew_lead: [
    "view_jobs", "edit_jobs", "create_jobs",
    "log_activities", "upload_photos", "edit_photos",
    "view_billing", "record_payments",
    "view_email", "send_email", "manage_reports",
  ],
  crew_member: ["view_jobs", "log_activities", "upload_photos"],
  custom: [],
};

// GET /api/settings/users — list all users with profiles
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get auth emails via service client
  try {
    const service = createServiceClient();
    const { data: authUsers } = await service.auth.admin.listUsers();

    const enriched = (data || []).map((profile) => {
      const authUser = authUsers?.users?.find((u) => u.id === profile.id);
      return {
        ...profile,
        email: authUser?.email || "",
      };
    });

    return NextResponse.json(enriched);
  } catch {
    // If service key not set, return profiles without emails
    return NextResponse.json(data || []);
  }
}

// POST /api/settings/users — invite new user
export async function POST(request: Request) {
  const { email, full_name, phone, role } = await request.json();

  if (!email || !full_name) {
    return NextResponse.json({ error: "Email and name are required" }, { status: 400 });
  }

  let service;
  try {
    service = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Service client unavailable" },
      { status: 500 }
    );
  }

  // Create auth user with invite
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name, role: role || "crew_member" },
  });

  if (authError) {
    if (authError.message.includes("already been registered")) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  const userId = authData.user.id;

  // Update profile with additional fields (trigger already created the row)
  await service.from("user_profiles").update({
    full_name,
    phone: phone || null,
    role: role || "crew_member",
  }).eq("id", userId);

  // Set default permissions for role
  const grantedPerms = ROLE_DEFAULTS[role || "crew_member"] || ROLE_DEFAULTS.crew_member;
  const permInserts = ALL_PERMISSIONS.map((perm) => ({
    user_id: userId,
    permission_key: perm,
    granted: grantedPerms.includes(perm),
  }));

  await service.from("user_permissions").upsert(permInserts, {
    onConflict: "user_id,permission_key",
  });

  return NextResponse.json({ id: userId, email, full_name, role }, { status: 201 });
}
