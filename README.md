This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment variables

The contract signing system (Build 15b) adds three required env vars on top
of the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `ENCRYPTION_KEY`:

```
RESEND_API_KEY=       # Resend API key (create at resend.com, verify sending domain via SPF/DKIM/DMARC)
SIGNING_LINK_SECRET=  # At least 32-char random string — HMAC secret for signing-link JWTs
NEXT_PUBLIC_APP_URL=  # e.g. https://aaaplatform.vercel.app — used to build public /sign/[token] URLs
```

Missing any of these will cause the send / sign endpoints to fail with a
clear error rather than silently falling back.

## QuickBooks Online (Build 16c)

QuickBooks Online integration adds four more env vars. Without them, the
OAuth routes fail fast at request time with a clear message.

```
QUICKBOOKS_CLIENT_ID=         # From Intuit Developer dashboard → your app
QUICKBOOKS_CLIENT_SECRET=     # Same dashboard, keep private
QUICKBOOKS_REDIRECT_URI=      # e.g. https://aaaplatform.vercel.app/api/qb/callback
QUICKBOOKS_ENVIRONMENT=       # "sandbox" for local dev, "production" for live books
```

For local dev, create a sandbox company at developer.intuit.com, use the
sandbox client ID/secret, and set `QUICKBOOKS_ENVIRONMENT=sandbox`. The
same `ENCRYPTION_KEY` that encrypts email passwords encrypts QB OAuth
tokens — no additional secret needed.

Build 16c ships with **dry-run mode on by default**. Connect via
**Settings → Accounting**, complete the setup wizard (sync start date +
class / deposit-account mappings), and the platform will record every
intended QB write to `qb_sync_log` without touching QB. Flip to live
mode only after reviewing the log on the Accounting page's QuickBooks
Sync tab. Expenses are platform-only and never sync to QB.

## Build 15b migrations

Run `supabase/migration-build33-contracts.sql` in the Supabase SQL Editor.
It creates the `contracts`, `contract_signers`, `contract_events`, and
`contract_email_settings` tables; adds `has_signed_contract` /
`has_pending_contract` columns to `jobs`; provisions the private
`contracts` storage bucket; installs RPC functions for atomic state
transitions; and seeds the email settings row. After running, visit
**Settings → Contracts** to fill in the send-from email and display name
(required before the first contract can be sent).
