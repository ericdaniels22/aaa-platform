// src/lib/jobs/payer-type.ts
// Computes payer_type for a job from received payments.
// The DB trigger payments_update_payer_type (migration-build36) maintains
// jobs.payer_type automatically on every payment INSERT/UPDATE/DELETE. This
// helper exists as a manual-recompute utility (useful for data fixes, tests,
// or if a future code path bypasses the DB).

import { createServiceClient } from "@/lib/supabase-api";

export type PayerType = "insurance" | "homeowner" | "mixed" | null;

export async function computePayerType(jobId: string): Promise<PayerType> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("recompute_job_payer_type", {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`computePayerType failed for job ${jobId}: ${error.message}`);
  }
  return (data as PayerType) ?? null;
}
