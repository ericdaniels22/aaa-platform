// Env access for QuickBooks. Throws at call time with a useful message if
// required vars are missing — never at import time (so a missing creds
// env doesn't break unrelated pages).

export type QbEnvironment = "sandbox" | "production";

export interface QbConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QbEnvironment;
}

export function getQbConfig(): QbConfig {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT as QbEnvironment | undefined;

  const missing: string[] = [];
  if (!clientId) missing.push("QUICKBOOKS_CLIENT_ID");
  if (!clientSecret) missing.push("QUICKBOOKS_CLIENT_SECRET");
  if (!redirectUri) missing.push("QUICKBOOKS_REDIRECT_URI");
  if (!environment) missing.push("QUICKBOOKS_ENVIRONMENT");
  if (missing.length > 0) {
    throw new Error(
      `QuickBooks env misconfigured — missing: ${missing.join(", ")}`,
    );
  }
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      `QUICKBOOKS_ENVIRONMENT must be "sandbox" or "production", got "${environment}"`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    environment,
  };
}

// Base URL for QBO Accounting API v3. We keep this here (instead of pulling
// from node-quickbooks) so raw fetch-based API calls in route handlers have
// a single source of truth.
export function getQboApiBase(environment: QbEnvironment): string {
  return environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}
