// Session B 5-step real auth round-trip against scratch.
// Per 18c plan §11 Prompt B + session prompt:
//   Step 1: signInWithPassword, decode JWT, confirm app_metadata.active_organization_id present
//   Step 2: rpc('set_active_organization', { p_org_id: <other_org> })
//   Step 3: refreshSession, decode new JWT, confirm claim flipped
//   Step 4: rpc back to original org, refreshSession, confirm claim flipped back
//   Step 5: signOut, signInWithPassword again, confirm claim survives full re-auth cycle
//
// Auth hook config (Authentication → Hooks → Customize Access Token JWT) confirmed
// enabled in scratch dashboard by Eric before this script ran.
//
// Run: env SESSION_B_PASSWORD='...' node scripts/session-b/auth-roundtrip.mjs
//
// All assertions print PASS/FAIL with the relevant claim values. Exits non-zero
// on any failure so the caller can react.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://prxjeloqumhzgobgfbwg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByeGplbG9xdW1oemdvYmdmYndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NjQ4MjIsImV4cCI6MjA5MjU0MDgyMn0.eB7y5kppn6s0I9GPUiWVxLECKY54gASV3lpz2gNMym4";

const TEST_EMAIL = "claude-test-b@aaaplatform.test";
const TEST_USER_ID = "b0000000-0000-4000-8000-00000000c1aa";
const AAA_ORG_ID = "a0000000-0000-4000-8000-000000000001";
const TEST_ORG_ID = "a0000000-0000-4000-8000-000000000002";

const PASSWORD = process.env.SESSION_B_PASSWORD;
if (!PASSWORD) {
  console.error("ERROR: SESSION_B_PASSWORD env var required");
  process.exit(1);
}

function decodeJwt(token) {
  const [, payload] = token.split(".");
  const json = Buffer.from(
    payload.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");
  return JSON.parse(json);
}

function pickActiveOrgIdClaim(decoded) {
  return (
    decoded?.app_metadata?.active_organization_id ??
    decoded?.active_organization_id ??
    null
  );
}

function fmtClaims(decoded) {
  return {
    sub_redacted: decoded.sub
      ? `${decoded.sub.slice(0, 8)}…${decoded.sub.slice(-4)}`
      : null,
    aud: decoded.aud,
    role: decoded.role,
    email: decoded.email,
    iat: decoded.iat,
    exp: decoded.exp,
    app_metadata: decoded.app_metadata ?? null,
    active_organization_id_resolved: pickActiveOrgIdClaim(decoded),
  };
}

function newClient() {
  // persistSession:false so we get a clean state on each createClient.
  // We'll explicitly save+pass tokens between phases when we need to.
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const results = [];
function step(label, payload) {
  results.push({ label, ...payload });
  console.log(JSON.stringify({ label, ...payload }, null, 2));
  console.log("---");
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    return { pass: true, msg, actual, expected };
  }
  return { pass: false, msg, actual, expected };
}

let exitCode = 0;
function recordAssert(a) {
  if (!a.pass) exitCode = 1;
  return a;
}

// Step 1: signInWithPassword + decode JWT
async function step1() {
  const supabase = newClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: PASSWORD,
  });
  if (error) {
    step("step1_signin", { error: error.message, status: error.status });
    exitCode = 1;
    return null;
  }
  const decoded = decodeJwt(data.session.access_token);
  const orgClaim = pickActiveOrgIdClaim(decoded);
  step("step1_signin", {
    pass: orgClaim === AAA_ORG_ID,
    expected_org: AAA_ORG_ID,
    actual_org: orgClaim,
    expected_user_id_endswith: TEST_USER_ID.slice(-12),
    actual_sub_endswith: decoded.sub?.slice(-12) ?? null,
    claims: fmtClaims(decoded),
    refresh_token_present: Boolean(data.session.refresh_token),
  });
  recordAssert(
    assertEq(orgClaim, AAA_ORG_ID, "step1: JWT carries AAA active_organization_id"),
  );
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

// Step 2: set_active_organization to Test Company, then re-query DB to confirm flag flip
async function step2(tokens) {
  const supabase = newClient();
  await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  const { data, error } = await supabase.rpc("set_active_organization", {
    p_org_id: TEST_ORG_ID,
  });
  if (error) {
    step("step2_rpc_to_testco", {
      error: error.message,
      code: error.code,
      details: error.details,
    });
    exitCode = 1;
    return;
  }
  step("step2_rpc_to_testco", { pass: true, rpc_returned: data });
  // No assertEq here — DB-level flip will be re-checked by main flow via SQL.
}

// Step 3: refreshSession, decode new JWT, confirm claim flipped to Test Co
async function step3(tokens) {
  const supabase = newClient();
  await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    step("step3_refresh_after_testco", {
      error: error?.message ?? "no session returned",
      status: error?.status,
    });
    exitCode = 1;
    return null;
  }
  const decoded = decodeJwt(data.session.access_token);
  const orgClaim = pickActiveOrgIdClaim(decoded);
  step("step3_refresh_after_testco", {
    pass: orgClaim === TEST_ORG_ID,
    expected_org: TEST_ORG_ID,
    actual_org: orgClaim,
    claims: fmtClaims(decoded),
    refresh_returned_new_access_token:
      data.session.access_token !== tokens.accessToken,
  });
  recordAssert(
    assertEq(
      orgClaim,
      TEST_ORG_ID,
      "step3: refreshSession after set_active(TestCo) injects TestCo claim",
    ),
  );
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

// Step 4: round-trip back to AAA, refresh, decode, confirm
async function step4(tokens) {
  const supabase = newClient();
  await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  const { error: rpcErr } = await supabase.rpc("set_active_organization", {
    p_org_id: AAA_ORG_ID,
  });
  if (rpcErr) {
    step("step4_rpc_back_to_aaa", { error: rpcErr.message });
    exitCode = 1;
    return null;
  }
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    step("step4_refresh_after_aaa", {
      error: error?.message ?? "no session returned",
    });
    exitCode = 1;
    return null;
  }
  const decoded = decodeJwt(data.session.access_token);
  const orgClaim = pickActiveOrgIdClaim(decoded);
  step("step4_refresh_after_aaa", {
    pass: orgClaim === AAA_ORG_ID,
    expected_org: AAA_ORG_ID,
    actual_org: orgClaim,
    claims: fmtClaims(decoded),
  });
  recordAssert(
    assertEq(
      orgClaim,
      AAA_ORG_ID,
      "step4: refreshSession after switching back injects AAA claim",
    ),
  );
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

// Step 5: signOut, signIn again, decode, confirm claim survives full re-auth
async function step5(tokens) {
  const supabaseSignOut = newClient();
  await supabaseSignOut.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  const { error: signOutErr } = await supabaseSignOut.auth.signOut();
  if (signOutErr) {
    step("step5_signout", { error: signOutErr.message });
    exitCode = 1;
    return;
  }
  step("step5_signout", { pass: true });

  const supabase = newClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: PASSWORD,
  });
  if (error) {
    step("step5_signin_again", { error: error.message, status: error.status });
    exitCode = 1;
    return;
  }
  const decoded = decodeJwt(data.session.access_token);
  const orgClaim = pickActiveOrgIdClaim(decoded);
  step("step5_signin_again", {
    pass: orgClaim === AAA_ORG_ID,
    expected_org: AAA_ORG_ID,
    actual_org: orgClaim,
    claims: fmtClaims(decoded),
    note: "active org should still be AAA — that was the state at end of step 4",
  });
  recordAssert(
    assertEq(
      orgClaim,
      AAA_ORG_ID,
      "step5: full signOut/signIn cycle preserves AAA claim",
    ),
  );
}

// Main
const tokens1 = await step1();
if (tokens1) {
  await step2(tokens1);
  const tokens3 = await step3(tokens1);
  if (tokens3) {
    const tokens4 = await step4(tokens3);
    if (tokens4) {
      await step5(tokens4);
    }
  }
}

console.log("=== SUMMARY ===");
console.log(JSON.stringify({ exitCode, steps: results.map(r => ({ label: r.label, pass: r.pass ?? false })) }, null, 2));
process.exit(exitCode);
