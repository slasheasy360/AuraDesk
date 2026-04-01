import prisma from '../utils/prisma.js';
import * as gmailApi from './gmail.js';

// ── Per-account mutex ────────────────────────────────────────────────────────
// Prevents concurrent history processing for the same account, which would
// cause both calls to read the same startHistoryId and produce duplicates
// or advance the cursor incorrectly.
const accountLocks = new Map(); // accountId → Promise

function withAccountLock(accountId, fn) {
  const prev = accountLocks.get(accountId) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn after previous completes (even on error)
  accountLocks.set(accountId, next);
  // Clean up reference when the chain settles
  next.finally(() => {
    if (accountLocks.get(accountId) === next) accountLocks.delete(accountId);
  });
  return next;
}

/**
 * Process a Gmail Pub/Sub notification by fetching new messages via the History API
 * and saving them to the database + emitting socket events.
 *
 * Uses a per-account mutex to serialize concurrent Pub/Sub deliveries.
 * Re-reads the account from DB each time to get the freshest historyId.
 *
 * @param {object} account - ConnectedAccount (used for id and platformAccountId)
 * @param {object} io - Socket.io server instance
 */
export async function processGmailHistory(account, io) {
  return withAccountLock(account.id, () => _processGmailHistoryInner(account.id, io));
}

// Maximum number of times to re-check history when Pub/Sub fires before
// the History API reflects the change (common Gmail race condition).
const EMPTY_HISTORY_RETRIES = 2;
const EMPTY_HISTORY_DELAY_MS = 1500; // 1.5 seconds between retries

async function _processGmailHistoryInner(accountId, io) {
  // Always read fresh account state from DB to get latest historyId
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    include: { user: true },
  });

  if (!account) {
    console.warn(`[Gmail PubSub] Account ${accountId} not found`);
    return;
  }

  const startHistoryId = account.gmailHistoryId;
  if (!startHistoryId) {
    console.warn(`[Gmail PubSub] No historyId for account ${accountId}`);
    return;
  }

  const t0 = Date.now();
  console.log(`[Gmail PubSub] Fetching history for ${account.platformAccountId} since historyId=${startHistoryId}`);

  try {
    let messages;
    let newHistoryId;
    let attempt = 0;

    // Retry loop: Pub/Sub notifications can arrive before the History API
    // reflects the change. If we get 0 messages, wait briefly and retry.
    do {
      if (attempt > 0) {
        console.log(`[Gmail PubSub] Empty history retry ${attempt}/${EMPTY_HISTORY_RETRIES} for ${account.platformAccountId} (waiting ${EMPTY_HISTORY_DELAY_MS}ms)`);
        await new Promise((r) => setTimeout(r, EMPTY_HISTORY_DELAY_MS));
      }

      const result = await gmailApi.fetchHistoryMessages(accountId, startHistoryId);
      messages = result.messages;
      newHistoryId = result.newHistoryId;
      attempt++;
    } while (messages.length === 0 && attempt <= EMPTY_HISTORY_RETRIES);

    // Update historyId to the latest — always advance even if no messages,
    // so we don't re-scan the same range on the next notification.
    if (newHistoryId) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { gmailHistoryId: String(newHistoryId) },
      });
      console.log(`[Gmail PubSub] historyId advanced ${startHistoryId} → ${newHistoryId} for ${account.platformAccountId}`);
    }

    if (messages.length === 0) {
      console.log(`[Gmail PubSub] No new messages for ${account.platformAccountId} after ${attempt} attempt(s) (${Date.now() - t0}ms)`);
      return;
    }

    console.log(`[Gmail PubSub] Processing ${messages.length} new message(s) for ${account.platformAccountId}`);

    const accountEmail = (account.platformAccountId || '').toLowerCase();
    let saved = 0;
    let skipped = 0;

    for (const msg of messages) {
      try {
        const result = await saveGmailMessage(msg, account, accountEmail, io);
        if (result === 'duplicate' || result === 'skipped') skipped++;
        else saved++;
      } catch (err) {
        console.error(`[Gmail PubSub] Failed to save message ${msg.id}:`, err.message);
      }
    }

    const latency = Date.now() - t0;
    console.log(`[Gmail PubSub] Done for ${account.platformAccountId}: ${saved} saved, ${skipped} skipped (${latency}ms, ${attempt} attempt(s))`);
  } catch (err) {
    // If historyId is too old, Gmail returns 404. Clear the expired historyId
    // and re-register the watch so startWatch assigns a fresh one.
    if (err?.response?.status === 404 || err?.code === 404) {
      console.warn(`[Gmail PubSub] HistoryId ${startHistoryId} expired for ${accountId}. Clearing and re-seeding watch.`);
      try {
        await prisma.connectedAccount.update({
          where: { id: accountId },
          data: { gmailHistoryId: null },
        });
        await gmailApi.startWatch(accountId);
        console.log(`[Gmail PubSub] Watch re-seeded with fresh historyId for ${accountId}`);
      } catch (watchErr) {
        console.error(`[Gmail PubSub] Re-seed watch failed:`, watchErr.message);
      }
      return;
    }
    throw err;
  }
}

/**
 * Save a single Gmail message to the DB and emit socket events.
 */
async function saveGmailMessage(msg, account, accountEmail, io) {
  // Skip messages that existed before the account was connected
  const msgTimestamp = Number(msg.internalDate);
  const connectedAt = new Date(account.createdAt).getTime();
  if (Number.isFinite(msgTimestamp) && msgTimestamp < connectedAt) {
    return 'skipped';
  }

  const headers = msg.payload?.headers || [];
  const fromHeader = extractHeader(headers, 'From');
  const toHeader = extractHeader(headers, 'To');
  const subject = extractHeader(headers, 'Subject') || '(No Subject)';
  const threadId = msg.threadId || msg.id;
  const labelIds = msg.labelIds || [];

  const { name: senderName, email: senderEmail } = parseEmailAddress(fromHeader);
  const isOutbound = senderEmail === accountEmail;

  console.log(`[Gmail PubSub] Message ${msg.id}: from="${fromHeader}", to="${toHeader}", labels=[${labelIds.join(',')}], senderEmail="${senderEmail}", accountEmail="${accountEmail}", isOutbound=${isOutbound}, threadId=${threadId}`);

  // Determine the "other party"
  let contactName = senderName;
  let contactEmail = senderEmail;
  if (isOutbound && toHeader) {
    const { name: toName, email: toEmail } = parseEmailAddress(toHeader);
    contactName = toName;
    contactEmail = toEmail;
  }

  // Upsert contact
  const contact = await prisma.contact.upsert({
    where: {
      userId_platform_platformUserId: {
        userId: account.userId,
        platform: 'gmail',
        platformUserId: contactEmail,
      },
    },
    update: { name: contactName },
    create: {
      userId: account.userId,
      platform: 'gmail',
      platformUserId: contactEmail,
      name: contactName,
    },
  });

  // Use the original email timestamp for message.sentAt (chronological order
  // within conversation), but current server time for lastMessageAt so the
  // conversation rises to the top of the inbox when a new email arrives.
  const timestamp = normalizeTimestamp(msg.internalDate);
  const now = new Date();
  const conversation = await prisma.conversation.upsert({
    where: {
      connectedAccountId_platformConversationId: {
        connectedAccountId: account.id,
        platformConversationId: threadId,
      },
    },
    update: {
      contactId: contact.id,
      lastMessageAt: now,
    },
    create: {
      connectedAccountId: account.id,
      platformConversationId: threadId,
      contactId: contact.id,
      lastMessageAt: now,
      unreadCount: 0,
    },
  });

  // Check for duplicate
  const existing = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      platformMessageId: msg.id,
    },
  });

  if (existing) {
    console.log(`[Gmail PubSub] Duplicate message ${msg.id} already in DB, skipping`);
    return 'duplicate';
  }

  // Extract and clean body
  const rawBody = gmailApi.getEmailBody(msg.payload || {});
  const body = cleanBody(rawBody);
  const htmlBody = gmailApi.getEmailHtmlBody(msg.payload || {}) || null;
  const emailAttachments = gmailApi.getEmailAttachments(msg.payload || {});

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      platformMessageId: msg.id,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender: senderName,
      subject,
      content: body || subject,
      htmlContent: htmlBody,
      contentType: 'email',
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
      status: isOutbound ? 'sent' : 'delivered',
      sentAt: timestamp,
      rawPayload: msg,
    },
  });

  // Update unread count for inbound messages and get accurate count
  let currentUnreadCount = conversation.unreadCount || 0;
  if (!isOutbound) {
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 } },
    });
    currentUnreadCount = updatedConversation.unreadCount;
  }

  // Emit real-time events to the user
  io.to(`user:${account.userId}`).emit('new_message', {
    message,
    conversationId: conversation.id,
    platform: 'gmail',
  });

  io.to(`user:${account.userId}`).emit('conversation_update', {
    conversationId: conversation.id,
    lastMessageAt: now,
    unreadCount: currentUnreadCount,
  });

  console.log(`[Gmail PubSub] Saved message ${msg.id} (${isOutbound ? 'outbound' : 'inbound'}) for ${account.platformAccountId}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHeader(headers, name) {
  const target = name.toLowerCase();
  const header = headers.find((h) => h.name?.toLowerCase() === target);
  return header?.value || '';
}

function parseEmailAddress(headerValue) {
  if (!headerValue) return { name: 'Unknown', email: 'unknown@unknown.local' };

  const match = headerValue.match(/<([^>]+)>/);
  if (match?.[1]) {
    const email = match[1].trim().toLowerCase();
    const name = headerValue.replace(/<[^>]+>/g, '').replace(/"/g, '').trim() || email;
    return { name, email };
  }

  const cleaned = headerValue.replace(/"/g, '').trim();
  return { name: cleaned, email: cleaned.toLowerCase() };
}

function normalizeTimestamp(internalDate) {
  const millis = Number(internalDate);
  return Number.isFinite(millis) ? new Date(millis) : new Date();
}

function cleanBody(rawBody) {
  if (!rawBody) return '';

  let text = rawBody;

  // Strip HTML
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Remove quoted reply blocks
  text = text.replace(/\r?\nOn .{10,150} wrote:\s*[\s\S]*$/m, '');

  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue;
    if (/^-{3,}\s*(Forwarded|Original)\s/i.test(line.trim())) break;
    cleaned.push(line);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
