import Stripe from "stripe";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export class StripeNotConnectedError extends Error {
  constructor() {
    super("No Stripe connection configured. Connect at /settings/stripe.");
    this.name = "StripeNotConnectedError";
  }
}

export interface StripeConnectionRow {
  id: string;
  organization_id: string;
  stripe_account_id: string;
  publishable_key: string;
  secret_key_encrypted: string;
  webhook_signing_secret_encrypted: string | null;
  mode: "test" | "live";
  ach_enabled: boolean;
  card_enabled: boolean;
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
  ach_preferred_threshold: number | null;
  default_statement_descriptor: string | null;
  surcharge_disclosure: string | null;
  last_connected_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function loadStripeConnection(orgId?: string): Promise<StripeConnectionRow | null> {
  const supabase = createServiceClient();
  const targetOrg = orgId ?? getActiveOrganizationId();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("*")
    .eq("organization_id", targetOrg)
    .maybeSingle();
  if (error) throw error;
  return (data as StripeConnectionRow | null) ?? null;
}

// Cache is keyed by organization_id so multi-tenant call sites don't trample
// each other. In 18a there's one org so the cache size is effectively 1.
const cachedClients = new Map<string, { accountId: string; client: Stripe }>();

export async function getStripeClient(orgId?: string): Promise<{ client: Stripe; connection: StripeConnectionRow }> {
  const targetOrg = orgId ?? getActiveOrganizationId();
  const connection = await loadStripeConnection(targetOrg);
  if (!connection) throw new StripeNotConnectedError();
  const cached = cachedClients.get(targetOrg);
  if (cached && cached.accountId === connection.stripe_account_id) {
    return { client: cached.client, connection };
  }
  const secret = decrypt(connection.secret_key_encrypted);
  const client = new Stripe(secret, {
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
    appInfo: { name: "aaa-platform", version: "18a" },
  });
  cachedClients.set(targetOrg, { accountId: connection.stripe_account_id, client });
  return { client, connection };
}

export async function getPublicKey(orgId?: string): Promise<string> {
  const connection = await loadStripeConnection(orgId);
  if (!connection) throw new StripeNotConnectedError();
  return connection.publishable_key;
}
