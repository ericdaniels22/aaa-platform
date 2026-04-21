// Low-level QBO API helpers. Uses plain fetch with a Bearer token —
// intuit-oauth.makeApiCall was over-encoding query strings and we already
// have our own refresh logic in tokens.ts, so we don't need the SDK's.
//
// Every helper takes a ValidToken from getValidAccessToken(); never call
// into QBO without one.

import { getQboApiBase } from "./config";
import type { QbEnvironment } from "./config";
import type {
  QbAccount,
  QbClass,
  QbCustomerPayload,
  QbInvoicePayload,
  QbInvoiceWriteResult,
  QbPaymentPayload,
  QbPaymentWriteResult,
} from "./types";

// Minimal token context — everything we need for a raw API call.
// Callers use `ValidToken` from tokens.ts; it's structurally compatible.
export interface QbApiContext {
  accessToken: string;
  realmId: string;
  environment: QbEnvironment;
}

interface QbApiError extends Error {
  status?: number;
  code?: string;
  detail?: string;
  raw?: unknown;
}

function errorFromResponse(status: number, body: unknown): QbApiError {
  const fault =
    body && typeof body === "object" && "Fault" in body
      ? (body as { Fault?: { Error?: Array<{ code?: string; Detail?: string; Message?: string }> } }).Fault
      : undefined;
  const first = fault?.Error?.[0];
  const err: QbApiError = new Error(
    first?.Message ?? first?.Detail ?? `QuickBooks API error (${status})`,
  );
  err.status = status;
  err.code = first?.code;
  err.detail = first?.Detail;
  err.raw = body;
  return err;
}

async function call<T>(
  token: QbApiContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const base = getQboApiBase(token.environment);
  const url = `${base}/v3/company/${token.realmId}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token.accessToken}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await resp.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON response (rare for QBO, but guard against it)
    }
  }

  if (!resp.ok) {
    throw errorFromResponse(resp.status, json ?? text);
  }
  return (json ?? {}) as T;
}

// ---------- Company info (used after OAuth to capture display name) ----------

export async function fetchCompanyName(token: QbApiContext): Promise<string | null> {
  try {
    const data = await call<{
      CompanyInfo?: { CompanyName?: string };
    }>(token, "GET", `/companyinfo/${token.realmId}`);
    return data.CompanyInfo?.CompanyName ?? null;
  } catch {
    return null;
  }
}

// ---------- Classes (damage-type mapping) ----------

export async function listClasses(token: QbApiContext): Promise<QbClass[]> {
  const query = "select * from Class where Active = true MAXRESULTS 500";
  const data = await call<{
    QueryResponse?: { Class?: QbClass[] };
  }>(token, "GET", `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.Class ?? [];
}

// ---------- Accounts (payment-method mapping) ----------

export async function listDepositAccounts(token: QbApiContext): Promise<QbAccount[]> {
  // QBO's query parser rejects parentheses in WHERE clauses, so use IN instead
  // of (AccountType = 'Bank' OR AccountType = 'Other Current Asset').
  const query =
    "select * from Account where AccountType IN ('Bank', 'Other Current Asset') AND Active = true MAXRESULTS 500";
  const data = await call<{
    QueryResponse?: { Account?: QbAccount[] };
  }>(token, "GET", `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.Account ?? [];
}

// ---------- Customers ----------

export interface CustomerWriteResult {
  id: string;
  syncToken: string;
}

export async function createCustomer(
  token: QbApiContext,
  payload: QbCustomerPayload,
): Promise<CustomerWriteResult> {
  const data = await call<{ Customer?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/customer",
    payload,
  );
  if (!data.Customer?.Id) {
    throw new Error("QuickBooks returned no Customer id");
  }
  return { id: data.Customer.Id, syncToken: data.Customer.SyncToken };
}

export async function updateCustomer(
  token: QbApiContext,
  payload: QbCustomerPayload,
): Promise<CustomerWriteResult> {
  if (!payload.Id || !payload.SyncToken) {
    throw new Error("updateCustomer requires Id and SyncToken on payload");
  }
  // QBO requires sparse: true to do partial updates; full updates require a
  // fresh SyncToken fetched just before the write.
  const data = await call<{ Customer?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/customer?operation=update",
    { ...payload, sparse: true },
  );
  if (!data.Customer?.Id) {
    throw new Error("QuickBooks returned no Customer id");
  }
  return { id: data.Customer.Id, syncToken: data.Customer.SyncToken };
}

export async function getCustomer(
  token: QbApiContext,
  id: string,
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const data = await call<{ Customer?: { Id: string; SyncToken: string } }>(
      token,
      "GET",
      `/customer/${id}`,
    );
    return data.Customer ?? null;
  } catch {
    return null;
  }
}

// ---------- Invoices ----------

export async function createInvoice(
  token: QbApiContext,
  payload: QbInvoicePayload,
): Promise<QbInvoiceWriteResult> {
  const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/invoice",
    payload,
  );
  if (!data.Invoice?.Id) throw new Error("QuickBooks returned no Invoice id");
  return { id: data.Invoice.Id, syncToken: data.Invoice.SyncToken };
}

export async function updateInvoice(
  token: QbApiContext,
  payload: QbInvoicePayload,
): Promise<QbInvoiceWriteResult> {
  if (!payload.Id || !payload.SyncToken) {
    throw new Error("updateInvoice requires Id and SyncToken");
  }
  // QB requires a full update for Invoice (sparse not supported the same way
  // as Customer), so the payload must be the complete re-computed state.
  const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/invoice?operation=update",
    payload,
  );
  if (!data.Invoice?.Id) throw new Error("QuickBooks returned no Invoice id");
  return { id: data.Invoice.Id, syncToken: data.Invoice.SyncToken };
}

export async function getInvoice(
  token: QbApiContext,
  id: string,
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
      token,
      "GET",
      `/invoice/${id}`,
    );
    return data.Invoice ?? null;
  } catch {
    return null;
  }
}

export async function voidInvoice(
  token: QbApiContext,
  id: string,
  syncToken: string,
): Promise<void> {
  await call<unknown>(token, "POST", "/invoice?operation=void", {
    Id: id,
    SyncToken: syncToken,
  });
}

// ---------- Payments ----------

export async function createPayment(
  token: QbApiContext,
  payload: QbPaymentPayload,
): Promise<QbPaymentWriteResult> {
  const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/payment",
    payload,
  );
  if (!data.Payment?.Id) throw new Error("QuickBooks returned no Payment id");
  return { id: data.Payment.Id, syncToken: data.Payment.SyncToken };
}

export async function updatePayment(
  token: QbApiContext,
  payload: QbPaymentPayload,
): Promise<QbPaymentWriteResult> {
  if (!payload.Id || !payload.SyncToken) {
    throw new Error("updatePayment requires Id and SyncToken");
  }
  const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/payment?operation=update",
    payload,
  );
  if (!data.Payment?.Id) throw new Error("QuickBooks returned no Payment id");
  return { id: data.Payment.Id, syncToken: data.Payment.SyncToken };
}

export async function getPayment(
  token: QbApiContext,
  id: string,
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
      token,
      "GET",
      `/payment/${id}`,
    );
    return data.Payment ?? null;
  } catch {
    return null;
  }
}

export async function deletePayment(
  token: QbApiContext,
  id: string,
  syncToken: string,
): Promise<void> {
  // QB hard-deletes payments when given `operation=delete` — no void equivalent.
  // This matches our platform semantics: a payment is either correct or a data error.
  await call<unknown>(token, "POST", "/payment?operation=delete", {
    Id: id,
    SyncToken: syncToken,
  });
}

// ---------- Purchases (used by 17c to post the Stripe processing fee as an expense) ----------

export interface QbPurchaseWriteResult {
  id: string;
  syncToken: string;
}

export async function createPurchase(
  token: QbApiContext,
  payload: Record<string, unknown>,
): Promise<QbPurchaseWriteResult> {
  const data = await call<{ Purchase?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/purchase",
    payload,
  );
  if (!data.Purchase?.Id) throw new Error("QuickBooks returned no Purchase id");
  return { id: data.Purchase.Id, syncToken: data.Purchase.SyncToken };
}

// ---------- Refund receipts (used by 17c to reconcile Stripe refunds to QB) ----------

export interface QbRefundReceiptWriteResult {
  id: string;
  syncToken: string;
}

export async function createRefundReceipt(
  token: QbApiContext,
  payload: Record<string, unknown>,
): Promise<QbRefundReceiptWriteResult> {
  const data = await call<{ RefundReceipt?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/refundreceipt",
    payload,
  );
  if (!data.RefundReceipt?.Id) {
    throw new Error("QuickBooks returned no RefundReceipt id");
  }
  return {
    id: data.RefundReceipt.Id,
    syncToken: data.RefundReceipt.SyncToken,
  };
}
