import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const MAX_AGE_SECONDS = 10 * 60; // 10 minutes

export class InvalidOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOAuthStateError";
  }
}

interface StatePayload {
  user_id: string;
  nonce: string;
  iat: number;
}

function getSecret(): Buffer {
  const s = process.env.STRIPE_CONNECT_STATE_SECRET;
  if (!s) throw new Error("STRIPE_CONNECT_STATE_SECRET is not set");
  if (s.length < 32) throw new Error("STRIPE_CONNECT_STATE_SECRET must be at least 32 hex chars");
  return Buffer.from(s, "utf8");
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

export function signOAuthState(userId: string): string {
  const payload: StatePayload = {
    user_id: userId,
    nonce: randomBytes(16).toString("hex"),
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", getSecret()).update(encoded).digest());
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): StatePayload {
  const parts = state.split(".");
  if (parts.length !== 2) throw new InvalidOAuthStateError("Malformed state");
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(encoded).digest();
  const provided = b64urlDecode(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new InvalidOAuthStateError("Signature mismatch");
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString("utf8")) as StatePayload;
  } catch {
    throw new InvalidOAuthStateError("Malformed payload");
  }
  if (!payload.user_id || !payload.nonce || !payload.iat) {
    throw new InvalidOAuthStateError("Missing claims");
  }
  const age = Math.floor(Date.now() / 1000) - payload.iat;
  if (age < 0 || age > MAX_AGE_SECONDS) throw new InvalidOAuthStateError("State expired");
  return payload;
}
