import { createHmac, timingSafeEqual } from "crypto";

export class InvalidPaymentLinkTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentLinkTokenError";
  }
}

export interface PaymentLinkTokenPayload {
  payment_request_id: string;
  job_id: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  return Buffer.from(
    (s + "=".repeat(pad === 4 ? 0 : pad)).replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}
function getSecret(): Buffer {
  const s = process.env.SIGNING_LINK_SECRET;
  if (!s) throw new Error("SIGNING_LINK_SECRET is not set");
  if (s.length < 32) throw new Error("SIGNING_LINK_SECRET must be at least 32 characters");
  return Buffer.from(s, "utf8");
}

export interface GeneratePaymentLinkTokenInput {
  paymentRequestId: string;
  jobId: string;
  expiresAt: Date;
}

export function generatePaymentLinkToken({
  paymentRequestId,
  jobId,
  expiresAt,
}: GeneratePaymentLinkTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        payment_request_id: paymentRequestId,
        job_id: jobId,
        iat: now,
        exp,
      } satisfies PaymentLinkTokenPayload),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", getSecret()).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export function verifyPaymentLinkToken(token: string): PaymentLinkTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidPaymentLinkTokenError("Malformed token");
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(`${header}.${payload}`).digest();
  const provided = b64urlDecode(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new InvalidPaymentLinkTokenError("Signature mismatch");
  }
  let parsed: PaymentLinkTokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8")) as PaymentLinkTokenPayload;
  } catch {
    throw new InvalidPaymentLinkTokenError("Malformed payload");
  }
  if (!parsed.payment_request_id || !parsed.job_id || !parsed.exp) {
    throw new InvalidPaymentLinkTokenError("Missing claims");
  }
  if (Math.floor(Date.now() / 1000) >= parsed.exp) {
    throw new InvalidPaymentLinkTokenError("Token expired");
  }
  return parsed;
}
