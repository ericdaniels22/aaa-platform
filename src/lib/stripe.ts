import Stripe from "stripe";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase-api";

export class StripeNotConnectedError extends Error {
  constructor() {
    super("No Stripe connection configured. Connect at /settings/stripe.");
    this.name = "StripeNotConnectedError";
  }
}

export interface StripeConnectionRow {
  id: string;
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

export async function loadStripeConnection(): Promise<StripeConnectionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as StripeConnectionRow | null) ?? null;
}

let cachedClient: { accountId: string; client: Stripe } | null = null;

export async function getStripeClient(): Promise<{ client: Stripe; connection: StripeConnectionRow }> {
  const connection = await loadStripeConnection();
  if (!connection) throw new StripeNotConnectedError();
  if (cachedClient && cachedClient.accountId === connection.stripe_account_id) {
    return { client: cachedClient.client, connection };
  }
  const secret = decrypt(connection.secret_key_encrypted);
  const client = new Stripe(secret, {
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
    appInfo: { name: "aaa-platform", version: "17a" },
  });
  cachedClient = { accountId: connection.stripe_account_id, client };
  return { client, connection };
}

export async function getPublicKey(): Promise<string> {
  const connection = await loadStripeConnection();
  if (!connection) throw new StripeNotConnectedError();
  return connection.publishable_key;
}
