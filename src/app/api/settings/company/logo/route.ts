import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// POST /api/settings/company/logo — upload company logo
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use PNG, JPG, SVG, or WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 2MB." },
      { status: 400 }
    );
  }

  const supabase = createApiClient();

  // Delete old logo if exists
  const { data: existing } = await supabase
    .from("company_settings")
    .select("value")
    .eq("key", "logo_path")
    .maybeSingle();

  if (existing?.value) {
    await supabase.storage.from("company-assets").remove([existing.value]);
  }

  // Upload new logo
  const ext = file.name.split(".").pop() || "png";
  const fileName = `logo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("company-assets")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Save path to company_settings
  await supabase
    .from("company_settings")
    .upsert(
      { key: "logo_path", value: fileName, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  // Return public URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/company-assets/${fileName}`;

  return NextResponse.json({ path: fileName, url: publicUrl });
}
