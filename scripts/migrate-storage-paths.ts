// Build 18a storage rename — prefix every storage object with the AAA org id.
//
// Runs from the maintenance window, after build42–build50 have applied.
// Idempotent: every phase is guarded so re-running the script from scratch
// produces the same end state. Resumable: progress is tracked in
// public.storage_migration_progress.
//
// Phases:
//   1. Enumerate objects in every bucket, upsert as 'pending' rows.
//   2. Copy each pending row to its new path, mark 'copied'.
//   3. Verify the new path exists in storage, mark 'verified'.
//   4. Call storage_paths_swap_to_new() — atomic DB-side path rewrite.
//   5. Delete originals for db_updated rows, mark 'deleted'.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/migrate-storage-paths.ts
//   npx tsx --env-file=.env.local scripts/migrate-storage-paths.ts --dry-run
//
// Exits non-zero if any row ends at status='failed'. See
// storage_migration_progress for diagnostics in that case.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const DRY_RUN = process.argv.includes("--dry-run");

// Per-bucket rules. Return null to skip an object (used for the knowledge-docs
// bucket whose objects are Nookleus product-level and not tenant-scoped).
const RULES: Record<string, (oldPath: string) => string | null> = {
  photos:              (p) => `${ORG_ID}/${p}`,
  receipts:            (p) => `${ORG_ID}/${p}`,
  contracts:           (p) => `${ORG_ID}/${p}`,
  reports:             (p) => `${ORG_ID}/${p}`,
  "email-attachments": (p) => `${ORG_ID}/${p}`,
  "job-files":         (p) => `${ORG_ID}/${p}`,
  "marketing-assets":  (p) => `${ORG_ID}/${p}`,
  "company-assets":    (p) => `${ORG_ID}/${p}`,
  "knowledge-docs":    () => null, // product-level, skip entirely
};

type StorageObject = { name: string; id: string | null };
type ProgressRow = {
  id: string;
  bucket_id: string;
  old_path: string;
  new_path: string;
  status: string;
};

async function listRecursive(
  supa: SupabaseClient,
  bucket: string,
  prefix = "",
): Promise<StorageObject[]> {
  const acc: StorageObject[] = [];
  const { data, error } = await supa.storage.from(bucket).list(prefix, {
    limit: 10000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`list ${bucket}:${prefix} failed: ${error.message}`);
  if (!data) return acc;

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Folders have id === null and no metadata; recurse into them.
    if (entry.id === null) {
      const children = await listRecursive(supa, bucket, path);
      acc.push(...children);
    } else {
      acc.push({ name: path, id: entry.id });
    }
  }
  return acc;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");

  const supa = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Storage rename — target org: ${ORG_ID}${DRY_RUN ? "  (DRY RUN)" : ""}`);

  // -------------------------------------------------------------------------
  // Phase 1: enumerate every object, upsert progress rows as 'pending'.
  // -------------------------------------------------------------------------
  let totalQueued = 0;
  for (const bucket of Object.keys(RULES)) {
    const rule = RULES[bucket];
    const objects = await listRecursive(supa, bucket);
    const prefixed = objects.filter((o) => !o.name.startsWith(`${ORG_ID}/`));
    const rows = prefixed
      .map((o) => {
        const newPath = rule(o.name);
        if (newPath === null) return null;
        return { bucket_id: bucket, old_path: o.name, new_path: newPath, status: "pending" };
      })
      .filter((r): r is { bucket_id: string; old_path: string; new_path: string; status: string } => r !== null);

    console.log(`[Phase 1] Enumerating bucket: ${bucket}... ${rows.length} objects queued`);
    totalQueued += rows.length;

    if (rows.length === 0) continue;
    if (DRY_RUN) continue;

    const { error } = await supa
      .from("storage_migration_progress")
      .upsert(rows, { onConflict: "bucket_id,old_path", ignoreDuplicates: true });
    if (error) throw new Error(`upsert progress (${bucket}): ${error.message}`);
  }

  if (DRY_RUN) {
    console.log(`\n[Dry run] Would queue ${totalQueued} objects. No changes made.`);
    return;
  }

  // -------------------------------------------------------------------------
  // Phase 2: copy every 'pending' object to its new path.
  // -------------------------------------------------------------------------
  const { data: pending, error: pendErr } = await supa
    .from("storage_migration_progress")
    .select("*")
    .eq("status", "pending")
    .returns<ProgressRow[]>();
  if (pendErr) throw new Error(`select pending: ${pendErr.message}`);

  console.log(`[Phase 2] Copying... 0/${pending.length} complete`);
  let copied = 0;
  for (const row of pending) {
    try {
      const { error } = await supa.storage.from(row.bucket_id).copy(row.old_path, row.new_path);
      if (error && !/exists|already/i.test(error.message)) throw new Error(error.message);
      await supa
        .from("storage_migration_progress")
        .update({ status: "copied", attempted_at: new Date().toISOString(), error_message: null })
        .eq("id", row.id);
      copied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supa
        .from("storage_migration_progress")
        .update({ status: "failed", attempted_at: new Date().toISOString(), error_message: msg })
        .eq("id", row.id);
      console.error(`  COPY FAILED ${row.bucket_id}/${row.old_path}: ${msg}`);
    }
  }
  console.log(`[Phase 2] Copying... ${copied}/${pending.length} complete`);

  // -------------------------------------------------------------------------
  // Phase 3: verify every copied row lands at the new path.
  // -------------------------------------------------------------------------
  const { data: copiedRows, error: copErr } = await supa
    .from("storage_migration_progress")
    .select("*")
    .eq("status", "copied")
    .returns<ProgressRow[]>();
  if (copErr) throw new Error(`select copied: ${copErr.message}`);

  console.log(`[Phase 3] Verifying... 0/${copiedRows.length} verified`);
  let verified = 0;
  for (const row of copiedRows) {
    try {
      const lastSlash = row.new_path.lastIndexOf("/");
      const dir = lastSlash === -1 ? "" : row.new_path.slice(0, lastSlash);
      const name = lastSlash === -1 ? row.new_path : row.new_path.slice(lastSlash + 1);
      const { data, error } = await supa.storage.from(row.bucket_id).list(dir, { limit: 10000, search: name });
      if (error) throw new Error(error.message);
      const found = !!data?.some((o) => o.name === name);
      if (!found) throw new Error("post-copy verification failed — new path not listed");
      await supa
        .from("storage_migration_progress")
        .update({ status: "verified", error_message: null })
        .eq("id", row.id);
      verified++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supa
        .from("storage_migration_progress")
        .update({ status: "failed", error_message: msg })
        .eq("id", row.id);
      console.error(`  VERIFY FAILED ${row.bucket_id}/${row.new_path}: ${msg}`);
    }
  }
  console.log(`[Phase 3] Verifying... ${verified}/${copiedRows.length} verified`);

  // Halt if any failures — the DB swap must not run with incomplete storage.
  const { data: failedRows, error: failErr } = await supa
    .from("storage_migration_progress")
    .select("id")
    .eq("status", "failed")
    .returns<{ id: string }[]>();
  if (failErr) throw new Error(`select failed count: ${failErr.message}`);
  if (failedRows.length > 0) {
    console.error(`\nHALT: ${failedRows.length} rows in status='failed'. See storage_migration_progress.`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Phase 4: DB-side atomic swap.
  // -------------------------------------------------------------------------
  console.log(`[Phase 4] Running storage_paths_swap_to_new()...`);
  const { error: rpcErr } = await supa.rpc("storage_paths_swap_to_new");
  if (rpcErr) throw new Error(`storage_paths_swap_to_new failed: ${rpcErr.message}`);
  console.log(`[Phase 4] Running storage_paths_swap_to_new()... OK`);

  // -------------------------------------------------------------------------
  // Phase 5: delete the original objects. Safe because the DB already points
  // to the new paths. A crash mid-phase just leaves orphans that can be
  // cleaned up by rerunning the script (picks up db_updated rows).
  // -------------------------------------------------------------------------
  const { data: toDelete, error: delErr } = await supa
    .from("storage_migration_progress")
    .select("*")
    .eq("status", "db_updated")
    .returns<ProgressRow[]>();
  if (delErr) throw new Error(`select db_updated: ${delErr.message}`);

  console.log(`[Phase 5] Deleting... 0/${toDelete.length} deleted`);
  let deleted = 0;
  for (const row of toDelete) {
    try {
      const { error } = await supa.storage.from(row.bucket_id).remove([row.old_path]);
      if (error) throw new Error(error.message);
      await supa
        .from("storage_migration_progress")
        .update({ status: "deleted", completed_at: new Date().toISOString(), error_message: null })
        .eq("id", row.id);
      deleted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supa
        .from("storage_migration_progress")
        .update({ status: "failed", error_message: msg })
        .eq("id", row.id);
      console.error(`  DELETE FAILED ${row.bucket_id}/${row.old_path}: ${msg}`);
    }
  }
  console.log(`[Phase 5] Deleting... ${deleted}/${toDelete.length} deleted`);

  // Final status check — fail the script if anything is in 'failed'.
  const { data: finalFailed, error: finalErr } = await supa
    .from("storage_migration_progress")
    .select("id")
    .eq("status", "failed")
    .returns<{ id: string }[]>();
  if (finalErr) throw new Error(`final failed check: ${finalErr.message}`);
  if (finalFailed.length > 0) {
    console.error(`\nStorage rename completed with ${finalFailed.length} failed rows. See storage_migration_progress.`);
    process.exit(1);
  }

  console.log(`\nStorage rename complete. ${deleted} objects migrated.`);
}

main().catch((e: unknown) => {
  console.error("\nStorage rename failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
