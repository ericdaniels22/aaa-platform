import { createHmac, timingSafeEqual } from "crypto";
import type { SigningTokenPayload } from "./types";

// Minimal HS256 JWT: header.payload.signature, all base64url-encoded.
// We don't pull in a full jose/jsonwebtoken dependency because the token
// is only ever produced and verified by this app — no interop needed.

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  const padded = s + "=".repeat(pad === 4 ? 0 : pad);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function getSecret(): Buffer {
  const s = process.env.SIGNING_LINK_SECRET;
  if (!s) throw new Error("SIGNING_LINK_SECRET is not set");
  if (s.length < 32) {
    throw new Error("SIGNING_LINK_SECRET must be at least 32 characters");
  }
  return Buffer.from(s, "utf8");
}

export interface GenerateTokenInput {
  contractId: string;
  signerId: string;
  expiresAt: Date;
}

export function generateSigningToken({ contractId, signerId, expiresAt }: GenerateTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);

  const headerPart = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payloadPart = base64url(
    Buffer.from(
      JSON.stringify({
        contract_id: contractId,
        signer_id: signerId,
        iat: now,
        exp,
      } satisfies SigningTokenPayload),
    ),
  );

  const signingInput = `${headerPart}.${payloadPart}`;
  const sig = base64url(createHmac("sha256", getSecret()).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export class InvalidSigningTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSigningTokenError";
  }
}

export function verifySigningToken(token: string): SigningTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidSigningTokenError("Malformed token");
  const [headerPart, payloadPart, sigPart] = parts;

  const expectedSig = createHmac("sha256", getSecret())
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const providedSig = base64urlDecode(sigPart);

  if (
    expectedSig.length !== providedSig.length ||
    !timingSafeEqual(expectedSig, providedSig)
  ) {
    throw new InvalidSigningTokenError("Signature mismatch");
  }

  let payload: SigningTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString("utf8")) as SigningTokenPayload;
  } catch {
    throw new InvalidSigningTokenError("Malformed payload");
  }

  if (!payload.contract_id || !payload.signer_id || !payload.exp) {
    throw new InvalidSigningTokenError("Missing required claims");
  }
  if (Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new InvalidSigningTokenError("Token expired");
  }

  return payload;
}
