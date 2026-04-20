// POST /api/stripe/webhooks — Stripe event receiver.
//
// 16d scope: verify signature with STRIPE_WEBHOOK_SECRET, log recognized
// events, return 200 for everything. No DB writes.
//
// TODO(build-17): On payment_intent.succeeded, look up the invoice by
// event.data.object.metadata.invoice_id, insert a platform payment row,
// and let the existing DB trigger enqueue the QB sync. All plumbing is
// already in place — this is the only file Build 17 needs to edit.

import { NextResponse } from "next/server";
import crypto from "node:crypto";

const TOLERANCE_SECONDS = 300; // standard Stripe tolerance

function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!t || !sig) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;

  const signed = `${t}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — return 200 so Stripe stops retrying, but log.
    console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured; stub is inert");
    return NextResponse.json({ ok: true, stub: true });
  }

  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!verifyStripeSignature(payload, sig, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: { type?: string; id?: string } = {};
  try {
    event = JSON.parse(payload) as { type?: string; id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    event.type === "payment_intent.succeeded"
    || event.type === "payment_intent.payment_failed"
    || event.type === "charge.refunded"
  ) {
    console.log(`[stripe-webhook] received ${event.type} id=${event.id ?? "-"}`);
  } else {
    console.log(`[stripe-webhook] ignored ${event.type} id=${event.id ?? "-"}`);
  }

  // TODO(build-17): create platform payment row here on payment_intent.succeeded.
  return NextResponse.json({ ok: true });
}
