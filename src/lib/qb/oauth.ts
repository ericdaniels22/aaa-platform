// Thin wrapper around intuit-oauth's OAuthClient. Used by the /authorize
// and /callback routes, and by token refresh. Creating a client is cheap,
// so we create fresh instances rather than caching module-scoped state
// (avoids subtle issues in serverless environments).

import OAuthClient from "intuit-oauth";
import { getQbConfig } from "./config";

export function createOAuthClient(): OAuthClient {
  const cfg = getQbConfig();
  return new OAuthClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
    environment: cfg.environment,
  });
}

// Intuit's Accounting scope — the only one 16c needs.
export const QB_SCOPES = [OAuthClient.scopes.Accounting];
