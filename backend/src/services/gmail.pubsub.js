import prisma from '../utils/prisma.js';
import * as gmailApi from './gmail.js';

/**
 * Process a Gmail Pub/Sub notification by fetching new messages via the History API
 * and saving them to the database + emitting socket events.
 *
 * @param {object} account - ConnectedAccount with user relation populated
 * @param {object} io - Socket.io server instance
 */
export async function processGmailHistory(account, io) {
  const startHistoryId = account.gmailHistoryId;
  if (!startHistoryId) {
    console.warn(`[Gmail PubSub] No historyId for account ${account.id}`);
    return;
  }

  try {
    const { messages, newHistoryId } = await gmailApi.fetchHistoryMessages(
      account.id,
      startHistoryId
    );

    // Update historyId to the latest
    if (newHistoryId) {
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { gmailHistoryId: String(newHistoryId) },
      });
    }

    if (messages.length === 0) {
      console.log(`[Gmail PubSub] No new messages for ${account.platformAccountId}`);
      return;
    }

    console.log(`[Gmail PubSub] Processing ${messages.length} new message(s) for ${account.platformAccountId}`);

    const accountEmail = (account.platformAccountId || '').toLowerCase();

    for (const msg of messages) {
      try {
        await saveGmailMessage(msg, account, accountEmail, io);
      } catch (err) {
        console.error(`[Gmail PubSub] Failed to save message ${msg.id}:`, err.message);
      }
    }
  } catch (err) {
    // If historyId is too old, Gmail returns 404. Re-seed with a full sync.
    if (err?.response?.status === 404 || err?.code === 404) {
      console.warn(`[Gmail PubSub] HistoryId ${startHistoryId} expired for ${account.id}. Re-seeding watch.`);
      try {
        await gmailApi.startWatch(account.id);
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
  const headers = msg.payload?.headers || [];
  const fromHeader = extractHeader(headers, 'From');
  const toHeader = extractHeader(headers, 'To');
  const subject = extractHeader(headers, 'Subject') || '(No Subject)';
  const threadId = msg.threadId || msg.id;

  const { name: senderName, email: senderEmail } = parseEmailAddress(fromHeader);
  const isOutbound = senderEmail === accountEmail;

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

  // Upsert conversation
  const timestamp = normalizeTimestamp(msg.internalDate);
  const conversation = await prisma.conversation.upsert({
    where: {
      connectedAccountId_platformConversationId: {
        connectedAccountId: account.id,
        platformConversationId: threadId,
      },
    },
    update: {
      contactId: contact.id,
      lastMessageAt: timestamp,
    },
    create: {
      connectedAccountId: account.id,
      platformConversationId: threadId,
      contactId: contact.id,
      lastMessageAt: timestamp,
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

  if (existing) return; // Already processed

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

  // Update unread count for inbound messages
  if (!isOutbound) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 } },
    });
  }

  // Emit real-time events to the user
  io.to(`user:${account.userId}`).emit('new_message', {
    message,
    conversationId: conversation.id,
    platform: 'gmail',
  });

  io.to(`user:${account.userId}`).emit('conversation_update', {
    conversationId: conversation.id,
    lastMessageAt: timestamp,
    unreadCount: isOutbound ? 0 : 1,
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
