// One-time setup: encrypt the platform Stripe keys and insert the single
// stripe_connection row. Use this instead of the /settings/stripe OAuth
// flow when you're a single-tenant app and don't need Stripe Connect.
//
// Run: npx tsx --env-file=.env.local scripts/seed-stripe-connection.ts
//
// Prompts for:
//   - secret key (sk_test_... or sk_live_...)
//   - publishable key (pk_test_... or pk_live_...)
// Encrypts the secret with ENCRYPTION_KEY, detects live/test from the prefix,
// calls stripe.accounts.retrieve() to get the account id, then delete-then-
// inserts one row into stripe_connection.

import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { encrypt } from "../src/lib/encryption";

async function prompt(q: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(q);
  } finally {
    rl.close();
  }
}

function preview(key: string): string {
  if (key.length < 12) return `<${key.length} chars — too short>`;
  return `${key.slice(0, 12)}…${key.slice(-4)} (len=${key.length})`;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");
  if (!encryptionKey) throw new Error("ENCRYPTION_KEY is not set in .env.local");

  console.log("Stripe connection setup — single-tenant direct-key mode");
  console.log("Paste your Stripe keys. They will be encrypted before storage.\n");

  const secretKey = (await prompt("Secret key (sk_test_... or sk_live_...): ")).trim();
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
    throw new Error("Secret key must start with sk_test_ or sk_live_");
  }

  const publishableKey = (await prompt("Publishable key (pk_test_... or pk_live_...): ")).trim();
  if (!publishableKey.startsWith("pk_test_") && !publishableKey.startsWith("pk_live_")) {
    throw new Error("Publishable key must start with pk_test_ or pk_live_");
  }

  const mode: "test" | "live" = secretKey.startsWith("sk_live_") ? "live" : "test";
  const pubMode = publishableKey.startsWith("pk_live_") ? "live" : "test";
  if (mode !== pubMode) {
    throw new Error(
      `Key mode mismatch — secret is ${mode}, publishable is ${pubMode}. They must match.`,
    );
  }

  console.log(`\nSecret: ${preview(secretKey)}`);
  console.log(`Publishable: ${preview(publishableKey)}`);
  console.log(`\nValidating keys against Stripe (${mode} mode)...`);
  const stripe = new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
  const account = await stripe.accounts.retrieveCurrent();
  console.log(`  Account: ${account.id} (${account.business_profile?.name ?? account.email ?? "no label"})`);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Clearing existing stripe_connection row (if any)...");
  const { error: delErr } = await supabase
    .from("stripe_connection")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

  console.log("Inserting new row with encrypted secret...");
  const { error: insErr } = await supabase.from("stripe_connection").insert({
    stripe_account_id: account.id,
    publishable_key: publishableKey,
    secret_key_encrypted: encrypt(secretKey),
    mode,
    last_connected_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`);

  console.log(`\n✓ Stripe connection seeded for ${account.id} in ${mode} mode.`);
  console.log("  Visit /settings/stripe to verify.");
}

main().catch((e: unknown) => {
  console.error("\n✗ Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
