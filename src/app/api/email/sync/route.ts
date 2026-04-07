import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { decrypt } from "@/lib/encryption";
import { ImapFlow, FetchMessageObject } from "imapflow";
import { matchEmailToJob } from "@/lib/email-matcher";
import { simpleParser, Attachment } from "mailparser";

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

  const password = decrypt(account.encrypted_password);
  const isFirstSync = !account.last_synced_uid || account.last_synced_uid === 0;

  let client: ImapFlow | null = null;
  let totalSynced = 0;
  let totalMatched = 0;
  let highestUid = account.last_synced_uid || 0;
  const errors: string[] = [];

  try {
    client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_port === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      tls: { rejectUnauthorized: false },
    });

    await client.connect();

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

        // Determine fetch range
        let range: string;
        if (isFirstSync) {
          // First sync: last 30 days via SEARCH, or last N messages by sequence
          const totalMessages = mailbox.exists || 0;
          if (totalMessages === 0) {
            await client.mailboxClose();
            continue;
          }
          const startSeq = Math.max(1, totalMessages - maxPerFolder + 1);
          range = `${startSeq}:*`;
        } else {
          // Incremental: fetch by UID > last synced
          range = `${highestUid + 1}:*`;
        }

        const messages: FetchMessageObject[] = [];
        try {
          for await (const msg of client.fetch(
            range,
            { uid: true, envelope: true, source: true, bodyStructure: true },
            { uid: !isFirstSync }
          )) {
            messages.push(msg);
            if (messages.length >= maxPerFolder) break;
          }
        } catch {
          // Empty range
        }

        for (const msg of messages) {
          try {
            const uid = msg.uid;
            if (uid > highestUid) highestUid = uid;

            const messageId = msg.envelope?.messageId || "uid-" + uid + "-" + folderPath;

            // Dedup check — same message can exist in different folders (sent + inbox)
            const { data: existing } = await supabase
              .from("emails")
              .select("id")
              .eq("message_id", messageId)
              .eq("account_id", accountId)
              .eq("folder", folder)
              .maybeSingle();

            if (existing) continue;

            // Parse full message
            let bodyText = "";
            let bodyHtml = "";
            let hasAttachments = false;
            let parsedAttachments: Attachment[] = [];

            if (msg.source) {
              const parsed = await simpleParser(msg.source);
              bodyText = parsed.text || "";
              bodyHtml = typeof parsed.html === "string" ? parsed.html : "";
              parsedAttachments = parsed.attachments || [];
              hasAttachments = parsedAttachments.length > 0;
            }

            // Also check bodyStructure for attachments
            if (!hasAttachments && msg.bodyStructure) {
              hasAttachments = checkAttachments(msg.bodyStructure);
            }

            const envelope = msg.envelope;
            if (!envelope) continue;

            const fromAddr = envelope.from?.[0]?.address || "";
            const fromName = envelope.from?.[0]?.name || "";
            const subject = envelope.subject || "";
            const date = envelope.date || new Date();

            // Build address arrays
            const toAddresses = (envelope.to || []).map((a) => ({
              email: a.address || "",
              name: a.name || undefined,
            }));
            const ccAddresses = (envelope.cc || []).map((a) => ({
              email: a.address || "",
              name: a.name || undefined,
            }));

            // Compute thread_id from References/In-Reply-To
            const threadId = envelope.inReplyTo || messageId;

            // Snippet
            const snippet = bodyText
              .replace(/\r?\n/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200);

            // Try to match to a job
            const match = await matchEmailToJob(
              supabase,
              { from_address: fromAddr, to_addresses: toAddresses, subject, body_text: bodyText },
              account.email_address
            );

            const { data: insertedEmail, error: insertError } = await supabase
              .from("emails")
              .insert({
                account_id: accountId,
                job_id: match?.job_id || null,
                message_id: messageId,
                thread_id: threadId,
                folder,
                from_address: fromAddr,
                from_name: fromName || null,
                to_addresses: toAddresses,
                cc_addresses: ccAddresses,
                bcc_addresses: [],
                subject,
                body_text: bodyText || null,
                body_html: bodyHtml || null,
                snippet: snippet || null,
                is_read: folder === "sent" || folder === "drafts",
                is_starred: false,
                has_attachments: hasAttachments,
                matched_by: match?.matched_by || null,
                uid,
                received_at: date,
              })
              .select("id")
              .single();

            if (insertError) {
              errors.push(folderPath + " UID " + uid + ": " + insertError.message);
            } else {
              totalSynced++;
              if (match) totalMatched++;

              // Save attachments to storage + metadata table
              if (insertedEmail && parsedAttachments.length > 0) {
                for (const att of parsedAttachments) {
                  try {
                    const storagePath = `${accountId}/${insertedEmail.id}/${att.filename || "attachment"}`;
                    await supabase.storage
                      .from("email-attachments")
                      .upload(storagePath, att.content, {
                        contentType: att.contentType || "application/octet-stream",
                        upsert: true,
                      });
                    await supabase.from("email_attachments").insert({
                      email_id: insertedEmail.id,
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
          } catch (msgErr) {
            errors.push(folderPath + ": " + (msgErr instanceof Error ? msgErr.message : "unknown"));
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
        last_synced_uid: highestUid > (account.last_synced_uid || 0) ? highestUid : account.last_synced_uid,
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
