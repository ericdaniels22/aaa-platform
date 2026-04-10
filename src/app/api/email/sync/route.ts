import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { decrypt } from "@/lib/encryption";
import { ImapFlow, FetchMessageObject } from "imapflow";
import { matchEmailToJob, type MatcherCache, type JobRow, type ContactRow } from "@/lib/email-matcher";
import { simpleParser, Attachment } from "mailparser";
import { categorizeEmail, type CategoryRule, type Category } from "@/lib/email-categorizer";

interface ParsedEmail {
  uid: number;
  messageId: string;
  threadId: string;
  fromAddr: string;
  fromName: string | null;
  toAddresses: { email: string; name?: string }[];
  ccAddresses: { email: string; name?: string }[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  receivedAt: Date;
  parsedAttachments: Attachment[];
  headers: Record<string, string>;
}

// Map IMAP folder names to our normalized folder enum
function mapFolder(imapPath: string): string {
  const lower = imapPath.toLowerCase().replace(/^(\[gmail\]|inbox)\/?/i, "").trim();
  const original = imapPath.toLowerCase();

  // Exact match on full path first
  if (original === "inbox") return "inbox";

  // Match by known keywords
  if (lower === "sent" || lower === "sent messages" || lower === "sent items" || lower === "sent mail")
    return "sent";
  if (lower === "drafts" || lower === "draft") return "drafts";
  if (lower === "trash" || lower === "deleted items" || lower === "deleted messages" || lower === "bin")
    return "trash";
  if (lower === "spam" || lower === "junk" || lower === "junk e-mail" || lower === "bulk mail")
    return "spam";
  if (lower === "archive" || lower === "all mail" || lower === "archives")
    return "archive";

  // Fallback: broader keyword matching
  if (original.includes("sent")) return "sent";
  if (original.includes("draft")) return "drafts";
  if (original.includes("trash") || original.includes("deleted")) return "trash";
  if (original.includes("spam") || original.includes("junk")) return "spam";
  if (original.includes("archive") || original.includes("all mail")) return "archive";

  // Store anything else as lowercase
  return original;
}

// Folders to sync — covers Hostinger, Network Solutions, Gmail, Outlook
const SYNC_FOLDERS = [
  "INBOX",
  "Sent", "Sent Messages", "Sent Items", "INBOX.Sent",
  "[Gmail]/Sent Mail",
  "Drafts", "[Gmail]/Drafts", "INBOX.Drafts",
  "Trash", "Deleted Items", "[Gmail]/Trash", "INBOX.Trash",
  "Junk", "Spam", "[Gmail]/Spam", "INBOX.Spam", "INBOX.Junk",
  "Archive", "[Gmail]/All Mail",
];

// POST /api/email/sync — sync emails for a specific account
// Body: { accountId: string, maxPerFolder?: number }
export async function POST(request: NextRequest) {
  const { accountId, maxPerFolder = 100 } = await request.json();

  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const supabase = createApiClient();

  const { data: account, error: accError } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accError || !account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  let password: string;
  try {
    password = decrypt(account.encrypted_password);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to decrypt password: ${err instanceof Error ? err.message : "check ENCRYPTION_KEY"}` },
      { status: 500 }
    );
  }

  let client: ImapFlow | null = null;
  let totalSynced = 0;
  let totalMatched = 0;
  const errors: string[] = [];

  try {
    client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_port === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
    });

    await client.connect();

    // Pre-fetch job matching cache (once for entire sync)
    const { data: jobsData } = await supabase
      .from("jobs")
      .select("id, job_number, claim_number, property_address, contact_id, adjuster_contact_id")
      .not("status", "eq", "cancelled");

    const jobs = (jobsData || []) as JobRow[];

    const contactIds = new Set<string>();
    for (const job of jobs) {
      contactIds.add(job.contact_id);
      if (job.adjuster_contact_id) contactIds.add(job.adjuster_contact_id);
    }

    let contacts: ContactRow[] = [];
    if (contactIds.size > 0) {
      const { data: contactsData } = await supabase
        .from("contacts")
        .select("id, email")
        .in("id", Array.from(contactIds))
        .not("email", "is", null);
      contacts = (contactsData || []) as ContactRow[];
    }

    const matcherCache: MatcherCache = { jobs, contacts };

    // Pre-fetch category rules (once for entire sync)
    const { data: rulesData } = await supabase
      .from("category_rules")
      .select("match_type, match_value, category")
      .eq("is_active", true);
    const categoryRules = (rulesData || []) as CategoryRule[];

    // One-time per-account backfill of historical emails.
    // Paginates by keyset (id) instead of offset because the category filter
    // shrinks as rows get updated — offset-based pagination would skip rows.
    if (!account.category_backfill_completed_at) {
      let lastId: string | null = null;
      while (true) {
        let batchQuery = supabase
          .from("emails")
          .select("id, from_address, subject")
          .eq("account_id", accountId)
          .eq("category", "general")
          .order("id", { ascending: true })
          .limit(200);

        if (lastId) {
          batchQuery = batchQuery.gt("id", lastId);
        }

        const { data: oldEmails } = await batchQuery;

        if (!oldEmails || oldEmails.length === 0) break;

        const byCategory = new Map<Category, string[]>();
        for (const e of oldEmails as { id: string; from_address: string; subject: string }[]) {
          const cat = categorizeEmail(
            { from_address: e.from_address, subject: e.subject },
            categoryRules
          );
          if (cat !== "general") {
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(e.id);
          }
        }

        for (const [cat, ids] of byCategory) {
          await supabase.from("emails").update({ category: cat }).in("id", ids);
        }

        // Advance the keyset cursor to the last id we saw.
        // Rows whose category got changed are excluded from the next query by
        // the category filter; rows that stayed "general" are skipped by the
        // `id > lastId` cursor, so we make forward progress every iteration.
        lastId = (oldEmails[oldEmails.length - 1] as { id: string }).id;

        if (oldEmails.length < 200) break;
      }

      await supabase
        .from("email_accounts")
        .update({ category_backfill_completed_at: new Date().toISOString() })
        .eq("id", accountId);
    }

    // Discover available folders
    const folders = await client.list();
    const folderPaths = folders.map((f) => f.path);

    // Determine which folders to sync
    const foldersToSync: string[] = [];
    for (const wanted of SYNC_FOLDERS) {
      const match = folderPaths.find(
        (p) => p.toLowerCase() === wanted.toLowerCase()
      );
      if (match) foldersToSync.push(match);
    }
    // Always include INBOX
    if (!foldersToSync.some((f) => f.toLowerCase() === "inbox")) {
      foldersToSync.unshift("INBOX");
    }

    for (const folderPath of foldersToSync) {
      try {
        const mailbox = await client.mailboxOpen(folderPath);
        const folder = mapFolder(folderPath);

        // Batch fetch known message IDs for dedup
        const { data: knownEmails } = await supabase
          .from("emails")
          .select("message_id")
          .eq("account_id", accountId)
          .eq("folder", folder);
        const knownMessageIds = new Set((knownEmails || []).map((e: { message_id: string }) => e.message_id));

        // Always fetch last N messages by sequence number and rely on
        // batch dedup to skip known messages. This avoids the cross-folder
        // UID bug (UIDs are per-mailbox, not global).
        const totalMessages = mailbox.exists || 0;
        if (totalMessages === 0) {
          await client.mailboxClose();
          continue;
        }
        const startSeq = Math.max(1, totalMessages - maxPerFolder + 1);
        const range = `${startSeq}:*`;

        const messages: FetchMessageObject[] = [];
        try {
          for await (const msg of client.fetch(
            range,
            { uid: true, envelope: true, source: true, bodyStructure: true }
          )) {
            messages.push(msg);
            if (messages.length >= maxPerFolder) break;
          }
        } catch {
          // Empty range
        }

        // Parse all messages first
        const parsed: ParsedEmail[] = [];

        for (const msg of messages) {
          try {
            const uid = msg.uid;
            const messageId = msg.envelope?.messageId || "uid-" + uid + "-" + folderPath;

            // In-memory dedup check
            if (knownMessageIds.has(messageId)) continue;

            let bodyText = "";
            let bodyHtml = "";
            let hasAttachments = false;
            let msgAttachments: Attachment[] = [];

            const msgHeaders: Record<string, string> = {};
            if (msg.source) {
              const parsedMsg = await simpleParser(msg.source);
              bodyText = parsedMsg.text || "";
              bodyHtml = typeof parsedMsg.html === "string" ? parsedMsg.html : "";
              msgAttachments = parsedMsg.attachments || [];
              hasAttachments = msgAttachments.length > 0;
              // Flatten mailparser headers Map to a lowercased plain object
              if (parsedMsg.headers) {
                for (const [key, value] of parsedMsg.headers) {
                  msgHeaders[key.toLowerCase()] = String(value);
                }
              }
            }

            if (!hasAttachments && msg.bodyStructure) {
              hasAttachments = checkAttachments(msg.bodyStructure);
            }

            const envelope = msg.envelope;
            if (!envelope) continue;

            const fromAddr = envelope.from?.[0]?.address || "";
            const fromName = envelope.from?.[0]?.name || "";
            const subject = envelope.subject || "";
            const date = envelope.date || new Date();

            const toAddresses = (envelope.to || []).map((a) => ({
              email: a.address || "",
              name: a.name || undefined,
            }));
            const ccAddresses = (envelope.cc || []).map((a) => ({
              email: a.address || "",
              name: a.name || undefined,
            }));

            const threadId = envelope.inReplyTo || messageId;
            const snippet = bodyText
              .replace(/\r?\n/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200);

            parsed.push({
              uid,
              messageId,
              threadId,
              fromAddr,
              fromName: fromName || null,
              toAddresses,
              ccAddresses,
              subject,
              bodyText: bodyText || null,
              bodyHtml: bodyHtml || null,
              snippet: snippet || null,
              hasAttachments,
              receivedAt: date,
              parsedAttachments: msgAttachments,
              headers: msgHeaders,
            });
          } catch (msgErr) {
            errors.push(folderPath + ": " + (msgErr instanceof Error ? msgErr.message : "unknown"));
          }
        }

        // Batch insert emails
        if (parsed.length > 0) {
          const rows = parsed.map((p) => {
            const match = matchEmailToJob(
              matcherCache,
              { from_address: p.fromAddr, to_addresses: p.toAddresses, subject: p.subject, body_text: p.bodyText },
              account.email_address
            );

            const category = categorizeEmail(
              { from_address: p.fromAddr, subject: p.subject, headers: p.headers },
              categoryRules
            );

            return {
              account_id: accountId,
              job_id: match?.job_id || null,
              message_id: p.messageId,
              thread_id: p.threadId,
              folder,
              from_address: p.fromAddr,
              from_name: p.fromName,
              to_addresses: p.toAddresses,
              cc_addresses: p.ccAddresses,
              bcc_addresses: [],
              subject: p.subject,
              body_text: p.bodyText,
              body_html: p.bodyHtml,
              snippet: p.snippet,
              is_read: folder === "sent" || folder === "drafts",
              is_starred: false,
              has_attachments: p.hasAttachments,
              matched_by: match?.matched_by || null,
              uid: p.uid,
              received_at: p.receivedAt,
              category,
            };
          });

          const { data: insertedEmails, error: insertError } = await supabase
            .from("emails")
            .insert(rows)
            .select("id, message_id");

          if (insertError) {
            errors.push(folderPath + " batch insert: " + insertError.message);
          } else if (insertedEmails) {
            totalSynced += insertedEmails.length;
            const matchedCount = rows.filter((r) => r.job_id).length;
            totalMatched += matchedCount;

            // Save attachments for emails that have them
            const emailIdByMessageId = new Map(
              insertedEmails.map((e: { id: string; message_id: string }) => [e.message_id, e.id])
            );

            for (const p of parsed) {
              if (p.parsedAttachments.length === 0) continue;
              const emailId = emailIdByMessageId.get(p.messageId);
              if (!emailId) continue;

              for (const att of p.parsedAttachments) {
                try {
                  const storagePath = `${accountId}/${emailId}/${att.filename || "attachment"}`;
                  await supabase.storage
                    .from("email-attachments")
                    .upload(storagePath, att.content, {
                      contentType: att.contentType || "application/octet-stream",
                      upsert: true,
                    });
                  await supabase.from("email_attachments").insert({
                    email_id: emailId,
                    filename: att.filename || "attachment",
                    content_type: att.contentType || null,
                    file_size: att.size || null,
                    storage_path: storagePath,
                  });
                } catch {
                  // Non-fatal: skip attachment save errors
                }
              }
            }
          }
        }

        await client.mailboxClose();
      } catch (folderErr) {
        // Some folders may not exist on this server, skip them
        errors.push("Folder " + folderPath + ": " + (folderErr instanceof Error ? folderErr.message : "skipped"));
      }
    }

    // Update sync state
    await supabase
      .from("email_accounts")
      .update({
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", accountId);

    await client.logout();
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Sync failed",
        total_synced: totalSynced,
        total_matched: totalMatched,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    total_synced: totalSynced,
    total_matched: totalMatched,
    folders_synced: SYNC_FOLDERS.length,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}

// Recursively check bodyStructure for attachments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkAttachments(structure: any): boolean {
  if (structure.disposition === "attachment") return true;
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => checkAttachments(child));
  }
  return false;
}
