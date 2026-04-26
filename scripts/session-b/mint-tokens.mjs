// Session B token minter for /sign and /pay public-route audit verification.
// Uses SIGNING_LINK_SECRET (from .env.local — same secret on prod and scratch dev runs).
// Outputs the four tokens to stdout as JSON; the caller pipes them into UPDATE statements.

import { createHmac, randomBytes } from "crypto";

const SECRET = process.env.SIGNING_LINK_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("ERROR: SIGNING_LINK_SECRET missing or too short (need >=32 chars).");
  process.exit(1);
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintSign({ contractId, signerId, expiresAt }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ contract_id: contractId, signer_id: signerId, iat: now, exp }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", Buffer.from(SECRET, "utf8")).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

function mintPay({ paymentRequestId, jobId, expiresAt }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ payment_request_id: paymentRequestId, job_id: jobId, iat: now, exp }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", Buffer.from(SECRET, "utf8")).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

const tokens = {
  sign_aaa: mintSign({
    contractId: "44444444-4444-4444-4444-444444444444",
    signerId:   "55555555-5555-5555-5555-555555555555",
    expiresAt:  exp,
  }),
  sign_testco: mintSign({
    contractId: "f0000022-c011-4222-8000-000000000002",
    signerId:   "f0000022-5181-4222-8000-000000000002",
    expiresAt:  exp,
  }),
  pay_aaa: mintPay({
    paymentRequestId: "77777777-7777-7777-7777-777777777777",
    jobId:            "22222222-2222-2222-2222-222222222222",
    expiresAt:        exp,
  }),
  pay_testco: mintPay({
    paymentRequestId: "f0000022-9091-4222-8000-000000000002",
    jobId:            "f0000022-1010-4222-8000-000000000002",
    expiresAt:        exp,
  }),
};

console.log(JSON.stringify(tokens, null, 2));
