import prisma from '../utils/prisma.js';
import * as gmailApi from './gmail.js';

const DEFAULT_MAX_RESULTS = 50;

function extractHeader(headers = [], name) {
  const target = name.toLowerCase();
  const header = headers.find((h) => h.name?.toLowerCase() === target);
  return header?.value || '';
}

function parseSender(fromHeader) {
  if (!fromHeader) {
    return { sender: 'Unknown', senderEmail: 'unknown@unknown.local' };
  }

  const emailMatch = fromHeader.match(/<([^>]+)>/);
  if (emailMatch?.[1]) {
    const senderEmail = emailMatch[1].trim().toLowerCase();
    const senderName = fromHeader.replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
    return { sender: senderName || senderEmail, senderEmail };
  }

  const cleaned = fromHeader.replace(/"/g, '').trim();
  return { sender: cleaned, senderEmail: cleaned.toLowerCase() };
}

function normalizeTimestamp(internalDate) {
  const millis = Number(internalDate);
  return Number.isFinite(millis) ? new Date(millis) : new Date();
}

// Clean email body: strip HTML tags, quoted replies, and "On ... wrote:" blocks
function cleanEmailBody(rawBody) {
  if (!rawBody) return '';

  let text = rawBody;

  // Strip HTML tags
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

  // Remove "On ... wrote:" quoted reply blocks and everything after
  text = text.replace(/\r?\nOn .{10,150} wrote:\s*[\s\S]*$/m, '');

  // Remove lines starting with > (quoted replies)
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue;
    // Stop at "---------- Forwarded message ----------" etc.
    if (/^-{3,}\s*(Forwarded|Original)\s/i.test(line.trim())) break;
    cleaned.push(line);
  }

  text = cleaned.join('\n');

  // Collapse excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

async function getActiveGmailAccounts(userId) {
  return prisma.connectedAccount.findMany({
    where: {
      userId,
      platform: 'gmail',
      status: 'active',
    },
  });
}

async function fetchMessagesForAccount(connectedAccountId, afterDate, maxResults = DEFAULT_MAX_RESULTS) {
  const gmail = await gmailApi.getGmailClient(connectedAccountId);

  // Build query: only fetch emails after the connection date
  const queryParts = [];
  if (afterDate) {
    // Gmail search uses YYYY/MM/DD format
    const d = new Date(afterDate);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    queryParts.push(`after:${dateStr}`);
  }

  const listParams = {
    userId: 'me',
    maxResults,
    labelIds: ['INBOX'],
  };
  if (queryParts.length > 0) {
    listParams.q = queryParts.join(' ');
  }

  const listRes = await gmail.users.messages.list(listParams);

  const messageRefs = listRes.data.messages || [];
  if (messageRefs.length === 0) return [];

  return Promise.all(
    messageRefs.map(async (ref) => {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: ref.id,
        format: 'full',
      });
      return msgRes.data;
    })
  );
}

function toPreviewBody(fullMessage) {
  const payloadBody = gmailApi.getEmailBody(fullMessage.payload || {});
  if (payloadBody && payloadBody.trim().length > 0) {
    return cleanEmailBody(payloadBody).slice(0, 5000);
  }
  return (fullMessage.snippet || '').trim();
}

// Short preview for conversation list (first ~100 chars, no newlines)
function toSnippet(body) {
  if (!body) return '';
  return body.replace(/\n+/g, ' ').trim().slice(0, 150);
}

export async function getGmailMessages(userId) {
  const accounts = await getActiveGmailAccounts(userId);
  if (accounts.length === 0) return [];

  const all = [];

  for (const account of accounts) {
    // Fetch emails from 7 days before the account was connected
    const afterDate = new Date(account.createdAt);
    afterDate.setDate(afterDate.getDate() - 7);
    const messages = await fetchMessagesForAccount(account.id, afterDate);

    const accountEmail = (account.platformAccountId || '').toLowerCase();

    for (const msg of messages) {
      const headers = msg.payload?.headers || [];
      const fromHeader = extractHeader(headers, 'From');
      const toHeader = extractHeader(headers, 'To');
      const subject = extractHeader(headers, 'Subject') || '(No Subject)';
      const { sender, senderEmail } = parseSender(fromHeader);
      const body = toPreviewBody(msg);
      const htmlBody = gmailApi.getEmailHtmlBody(msg.payload || {}) || null;
      const emailAttachments = gmailApi.getEmailAttachments(msg.payload || {});

      // Determine the "other party" — for outbound emails, use the recipient
      const isOutbound = senderEmail === accountEmail;
      let contactName = sender;
      let contactEmail = senderEmail;
      if (isOutbound && toHeader) {
        const { sender: toName, senderEmail: toEmail } = parseSender(toHeader);
        contactName = toName;
        contactEmail = toEmail;
      }

      all.push({
        account,
        gmailMessageId: msg.id,
        threadId: msg.threadId || msg.id,
        sender,
        senderEmail,
        contactName,
        contactEmail,
        isOutbound,
        subject,
        snippet: toSnippet(body),
        body,
        htmlBody,
        attachments: emailAttachments.length > 0 ? emailAttachments : null,
        timestamp: normalizeTimestamp(msg.internalDate),
        labelIds: msg.labelIds || [],
        rawPayload: msg,
      });
    }
  }

  return all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export async function syncGmailMessages(userId) {
  const normalizedMessages = await getGmailMessages(userId);
  if (normalizedMessages.length === 0) return [];

  const synced = [];

  for (const item of normalizedMessages) {
    const { account } = item;

    // Use the "other party" as the contact (recipient for outbound, sender for inbound)
    const contact = await prisma.contact.upsert({
      where: {
        userId_platform_platformUserId: {
          userId,
          platform: 'gmail',
          platformUserId: item.contactEmail,
        },
      },
      update: {
        name: item.contactName,
      },
      create: {
        userId,
        platform: 'gmail',
        platformUserId: item.contactEmail,
        name: item.contactName,
      },
    });

    const conversation = await prisma.conversation.upsert({
      where: {
        connectedAccountId_platformConversationId: {
          connectedAccountId: account.id,
          platformConversationId: item.threadId,
        },
      },
      update: {
        lastMessageAt: item.timestamp,
      },
      create: {
        connectedAccountId: account.id,
        platformConversationId: item.threadId,
        contactId: contact.id,
        lastMessageAt: item.timestamp,
        unreadCount: item.labelIds.includes('UNREAD') ? 1 : 0,
      },
    });

    // Update contact only if conversation was just created (don't overwrite with wrong contact from later messages)
    if (!conversation.contactId || conversation.contactId !== contact.id) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { contactId: contact.id },
      });
    }

    const existing = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        platformMessageId: item.gmailMessageId,
      },
    });

    if (existing) {
      synced.push({ ...existing, _isNew: false });
      continue;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId: item.gmailMessageId,
        direction: item.isOutbound ? 'outbound' : 'inbound',
        sender: item.sender,
        subject: item.subject,
        content: item.body || item.snippet || item.subject,
        htmlContent: item.htmlBody || null,
        contentType: 'email',
        attachments: item.attachments || undefined,
        status: item.isOutbound ? 'sent' : 'delivered',
        sentAt: item.timestamp,
        rawPayload: item.rawPayload,
      },
    });

    if (!item.isOutbound && item.labelIds.includes('UNREAD')) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: { increment: 1 } },
      });
    }

    synced.push({ ...message, _isNew: true });
  }

  return synced;
}
