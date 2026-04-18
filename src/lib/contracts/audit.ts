import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContractEventType } from "./types";

export interface EventArgs {
  contractId: string;
  eventType: ContractEventType;
  signerId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Best-effort audit writer. Errors are rethrown so callers can choose to
// swallow (e.g. post-send non-critical paths) or surface to the caller.
export async function writeContractEvent(
  supabase: SupabaseClient,
  args: EventArgs,
): Promise<void> {
  const { error } = await supabase.from("contract_events").insert({
    contract_id: args.contractId,
    event_type: args.eventType,
    signer_id: args.signerId ?? null,
    ip_address: args.ipAddress ?? null,
    user_agent: args.userAgent ?? null,
    metadata: args.metadata ?? null,
  });
  if (error) throw new Error(`Failed to write contract_event: ${error.message}`);
}

export function getRequestIp(req: Request): string | null {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? null;
}

export function getRequestUserAgent(req: Request): string | null {
  return req.headers.get("user-agent");
}
