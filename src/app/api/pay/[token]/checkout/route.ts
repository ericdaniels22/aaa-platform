import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";
import { getStripeClient } from "@/lib/stripe";
import type { PaymentRequestRow } from "@/lib/payments/types";

// Mirror of the constant in src/app/api/payment-requests/route.ts — Stripe
// Checkout Sessions expire at most 24h after creation. 23.5h keeps us safely
// under the cap while matching 17a.
const STRIPE_SESSION_MAX_MS = 23.5 * 60 * 60 * 1000;

interface Body {
  method: "ach" | "card";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || (body.method !== "ach" && body.method !== "card")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 1. Token validation
  let payload: { payment_request_id: string; job_id: string };
  try {
    payload = verifyPaymentLinkToken(token);
  } catch (e) {
    const msg =
      e instanceof InvalidPaymentLinkTokenError ? e.message : "Invalid token";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", payload.payment_request_id)
    .maybeSingle<PaymentRequestRow>();
  if (prErr || !pr)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pr.link_token !== token)
    return NextResponse.json({ error: "token_replaced" }, { status: 400 });
  if (!["draft", "sent", "viewed"].includes(pr.status))
    return NextResponse.json(
      { error: `not_payable_from_status_${pr.status}` },
      { status: 400 },
    );
  if (
    pr.link_expires_at &&
    new Date(pr.link_expires_at).getTime() < Date.now()
  )
    return NextResponse.json({ error: "link_expired" }, { status: 400 });

  // 2. Stripe client + connection
  const { client: stripe, connection } = await getStripeClient();
  if (body.method === "ach" && !connection.ach_enabled)
    return NextResponse.json({ error: "ach_not_enabled" }, { status: 400 });
  if (body.method === "card" && !connection.card_enabled)
    return NextResponse.json({ error: "card_not_enabled" }, { status: 400 });

  const amount = Number(pr.amount);
  if (
    body.method === "card" &&
    connection.ach_preferred_threshold != null &&
    amount >= Number(connection.ach_preferred_threshold) &&
    connection.ach_enabled
  ) {
    return NextResponse.json(
      { error: "card_not_allowed_for_this_amount" },
      { status: 400 },
    );
  }

  const paymentMethodType: "card" | "us_bank_account" =
    body.method === "card" ? "card" : "us_bank_account";

  // 3. Compute target line-item total + possible surcharge
  const applySurcharge =
    body.method === "card" && connection.pass_card_fee_to_customer;
  const cardFee = applySurcharge
    ? Math.round(
        amount * (Number(connection.card_fee_percent) / 100) * 100,
      ) / 100
    : 0;
  const totalCents = Math.round((amount + cardFee) * 100);

  // 4. Decide reuse vs regenerate
  let sessionUrl: string | null = null;
  let newSessionId: string | null = null;

  if (pr.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        pr.stripe_checkout_session_id,
      );
      const reusable =
        existing.status === "open" &&
        typeof existing.expires_at === "number" &&
        existing.expires_at * 1000 > Date.now() &&
        Array.isArray(existing.payment_method_types) &&
        existing.payment_method_types.length === 1 &&
        existing.payment_method_types[0] === paymentMethodType &&
        existing.amount_total === totalCents;
      if (reusable && existing.url) {
        sessionUrl = existing.url;
      }
    } catch {
      // Retrieval can fail for deleted/expired sessions. Regenerate.
      sessionUrl = null;
    }
  }

  if (!sessionUrl) {
    // 5. Regenerate — cap at min(link_expires_at, now + 23.5h)
    const linkExpMs = pr.link_expires_at
      ? new Date(pr.link_expires_at).getTime()
      : Date.now() + STRIPE_SESSION_MAX_MS;
    const sessionExpiresAtMs = Math.min(
      linkExpMs,
      Date.now() + STRIPE_SESSION_MAX_MS,
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

    const lineItems = applySurcharge
      ? [
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: { name: pr.title },
              unit_amount: Math.round(amount * 100),
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: {
                name: `Card processing fee (${connection.card_fee_percent}%)`,
              },
              unit_amount: Math.round(cardFee * 100),
            },
          },
        ]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: { name: pr.title },
              unit_amount: Math.round(amount * 100),
            },
          },
        ];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: [paymentMethodType],
      line_items: lineItems,
      metadata: {
        payment_request_id: pr.id,
        job_id: pr.job_id,
        invoice_id: pr.invoice_id ?? "",
        request_type: pr.request_type,
        method: body.method,
      },
      payment_intent_data: {
        metadata: {
          payment_request_id: pr.id,
          job_id: pr.job_id,
          invoice_id: pr.invoice_id ?? "",
          request_type: pr.request_type,
          method: body.method,
        },
        statement_descriptor_suffix:
          connection.default_statement_descriptor?.slice(0, 22) || undefined,
        // 17c — suppress Stripe's default customer receipt. Our webhook
        // handler sends a branded receipt email with a PDF attached instead.
        // Stripe's TS types constrain `receipt_email` to `string | undefined`,
        // but the Stripe API accepts `null` to explicitly opt out of the
        // Dashboard default, so we cast through `unknown`.
        receipt_email: null as unknown as undefined,
      },
      customer_email: pr.payer_email ?? undefined,
      success_url: `${appUrl}/pay/${token}/success`,
      cancel_url: `${appUrl}/pay/${token}`,
      expires_at: Math.floor(sessionExpiresAtMs / 1000),
    });

    sessionUrl = session.url;
    newSessionId = session.id;

    // Best-effort: expire the previous session so it can't be reused via
    // a cached URL.
    if (
      pr.stripe_checkout_session_id &&
      pr.stripe_checkout_session_id !== newSessionId
    ) {
      try {
        await stripe.checkout.sessions.expire(pr.stripe_checkout_session_id);
      } catch {
        /* ignore */
      }
    }
  }

  if (!sessionUrl) {
    return NextResponse.json(
      { error: "session_url_missing" },
      { status: 500 },
    );
  }

  // 6. Persist pre-payment fields so webhook (17c) can verify consistency.
  const updatePatch: Record<string, unknown> = {
    card_fee_amount: applySurcharge ? cardFee : null,
    total_charged: amount + cardFee,
    payment_method_type: paymentMethodType,
  };
  if (newSessionId) {
    updatePatch.stripe_checkout_session_id = newSessionId;
  }
  await supabase.from("payment_requests").update(updatePatch).eq("id", pr.id);

  return NextResponse.json({ session_url: sessionUrl });
}
