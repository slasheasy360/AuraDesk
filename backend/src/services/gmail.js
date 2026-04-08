import fs from 'fs';
import { google } from 'googleapis';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

function maskEmail(email) {
  const [local, domain] = email.split('@');
  const visible = local.substring(0, 5);
  const masked = '*'.repeat(Math.max(local.length - 5, 0));
  return `${visible}${masked}@${domain}`;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state) {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state,
  });
}

export async function handleCallback(code, userId) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user profile
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();

  // Block if this Gmail address is already connected to another AuraDesk user
  const existingConnection = await prisma.connectedAccount.findFirst({
    where: {
      platform: 'gmail',
      platformAccountId: profile.email,
      status: 'active',
      userId: { not: userId },
    },
    include: { user: true },
  });
  if (existingConnection) {
    const maskedEmail = maskEmail(existingConnection.user.email);
    const error = new Error(`This account is already connected with: ${maskedEmail}`);
    error.code = 'DUPLICATE_ACCOUNT';
    throw error;
  }

  // Clean up any previous disconnected sessions for this user
  await prisma.connectedAccount.deleteMany({
    where: {
      userId,
      platform: 'gmail',
      platformAccountId: profile.email,
      status: 'disconnected',
    },
  });

  // Upsert connected account
  const connectedAccount = await prisma.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId,
        platform: 'gmail',
        platformAccountId: profile.email,
      },
    },
    update: {
      displayName: profile.name || profile.email,
      avatarUrl: profile.picture,
      status: 'active',
    },
    create: {
      userId,
      platform: 'gmail',
      platformAccountId: profile.email,
      displayName: profile.name || profile.email,
      avatarUrl: profile.picture,
      status: 'active',
    },
  });

  // Store tokens encrypted
  await prisma.authToken.upsert({
    where: { connectedAccountId: connectedAccount.id },
    update: {
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      tokenType: 'oauth2',
      scopes: 'gmail.modify',
    },
    create: {
      connectedAccountId: connectedAccount.id,
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      tokenType: 'oauth2',
      scopes: 'gmail.modify',
    },
  });

  return connectedAccount;
}

function getAuthedClient(accessToken, refreshToken) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return client;
}

// ── Gmail client cache ──────────────────────────────────────────────────────
// Avoids re-reading AuthToken from DB, decrypting, and constructing a new
// OAuth2 client on every single API call. The cached client auto-refreshes
// tokens via the 'tokens' event listener, so it stays valid across the
// access token's lifetime (~1 hour). Cache entries expire after 50 minutes
// to guarantee a fresh client before Google's token expiry.
const gmailClientCache = new Map(); // connectedAccountId → { gmail, expiresAt }
const CLIENT_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes

export async function getGmailClient(connectedAccountId) {
  const now = Date.now();
  const cached = gmailClientCache.get(connectedAccountId);
  if (cached && cached.expiresAt > now) {
    return cached.gmail;
  }

  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const accessToken = decrypt(authToken.accessTokenEncrypted);
  const refreshToken = authToken.refreshTokenEncrypted ? decrypt(authToken.refreshTokenEncrypted) : null;
  const client = getAuthedClient(accessToken, refreshToken);

  // Listen for token refresh — persist new tokens to DB
  client.on('tokens', async (newTokens) => {
    const updateData = {
      accessTokenEncrypted: encrypt(newTokens.access_token),
    };
    if (newTokens.refresh_token) {
      updateData.refreshTokenEncrypted = encrypt(newTokens.refresh_token);
    }
    if (newTokens.expiry_date) {
      updateData.expiresAt = new Date(newTokens.expiry_date);
    }
    await prisma.authToken.update({
      where: { connectedAccountId },
      data: updateData,
    });
    // Extend cache TTL after a successful token refresh
    const entry = gmailClientCache.get(connectedAccountId);
    if (entry) entry.expiresAt = Date.now() + CLIENT_CACHE_TTL_MS;
  });

  const gmail = google.gmail({ version: 'v1', auth: client });
  gmailClientCache.set(connectedAccountId, { gmail, expiresAt: now + CLIENT_CACHE_TTL_MS });
  return gmail;
}

/** Evict a cached client (call on disconnect or token revocation). */
export function evictGmailClient(connectedAccountId) {
  gmailClientCache.delete(connectedAccountId);
}

export async function fetchMessages(connectedAccountId, maxResults = 20) {
  const gmail = await getGmailClient(connectedAccountId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
  });

  if (!res.data.messages) return [];

  const messages = await Promise.all(
    res.data.messages.map(async (m) => {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      return msg.data;
    })
  );

  return messages;
}

export async function fetchThread(connectedAccountId, threadId) {
  const gmail = await getGmailClient(connectedAccountId);
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return res.data;
}

export async function sendEmail(connectedAccountId, to, subject, body, threadId, attachments = []) {
  const gmail = await getGmailClient(connectedAccountId);

  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
  });

  console.log('[Gmail API] Sending email:', {
    from: account?.platformAccountId,
    to,
    subject,
    threadId: threadId || null,
    attachmentCount: attachments.length,
  });

  // Get the Message-ID of the last message in the thread for proper In-Reply-To threading
  let lastMessageId = null;
  if (threadId) {
    try {
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['Message-ID'],
      });
      const threadMessages = threadRes.data.messages || [];
      if (threadMessages.length > 0) {
        const lastMsg = threadMessages[threadMessages.length - 1];
        const msgIdHeader = lastMsg.payload?.headers?.find(
          (h) => h.name.toLowerCase() === 'message-id'
        );
        lastMessageId = msgIdHeader?.value || null;
      }
    } catch (threadErr) {
      console.warn('[Gmail API] Could not fetch thread for In-Reply-To header:', threadErr.message);
      // Continue without In-Reply-To — message still sends
    }
  }

  const raw = createRawEmail(account.platformAccountId, to, subject, body, lastMessageId, attachments);

  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  console.log('[Gmail API] Email sent:', { messageId: res.data.id, threadId: res.data.threadId });
  return res.data;
}

function createRawEmail(from, to, subject, body, inReplyToMessageId, attachments = []) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hasAttachments = attachments.length > 0;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  if (inReplyToMessageId) {
    headers.push(`In-Reply-To: ${inReplyToMessageId}`);
    headers.push(`References: ${inReplyToMessageId}`);
  }

  if (!hasAttachments) {
    headers.push('Content-Type: text/plain; charset=utf-8');
    const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
    return Buffer.from(email).toString('base64url');
  }

  // Multipart email with attachments
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  let email = `${headers.join('\r\n')}\r\n\r\n`;

  // Text body part
  email += `--${boundary}\r\n`;
  email += 'Content-Type: text/plain; charset=utf-8\r\n\r\n';
  email += `${body}\r\n\r\n`;

  // Attachment parts — support both in-memory buffers (multer memory storage) and disk paths
  for (const file of attachments) {
    let fileData;
    if (file.buffer) {
      fileData = file.buffer;
    } else if (file.path) {
      fileData = fs.readFileSync(file.path);
    } else {
      console.warn('[Gmail API] Attachment skipped (no buffer or path):', file.originalname);
      continue;
    }
    const base64Data = fileData.toString('base64');
    email += `--${boundary}\r\n`;
    email += `Content-Type: ${file.mimetype}; name="${file.originalname}"\r\n`;
    email += 'Content-Transfer-Encoding: base64\r\n';
    email += `Content-Disposition: attachment; filename="${file.originalname}"\r\n\r\n`;
    email += `${base64Data}\r\n\r\n`;
  }

  email += `--${boundary}--`;

  return Buffer.from(email).toString('base64url');
}

// ─── Gmail Watch (Pub/Sub) ───────────────────────────────────────────────────

/**
 * Start watching a Gmail mailbox via Pub/Sub.
 * Returns { historyId, expiration } to store in the DB.
 */
export async function startWatch(connectedAccountId) {
  const gmail = await getGmailClient(connectedAccountId);
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) throw new Error('GMAIL_PUBSUB_TOPIC env var is not set');

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX', 'SENT'],
      labelFilterBehavior: 'include',
    },
  });

  const { historyId, expiration } = res.data;
  const expirationDate = new Date(Number(expiration));

  // Persist to DB — only set gmailHistoryId if it's null (first registration).
  // On re-registration, preserve the existing historyId to avoid skipping
  // messages that arrived between the old and new historyId.
  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
  });
  if (account) {
    const updateData = { gmailWatchExpiration: expirationDate };
    if (!account.gmailHistoryId) {
      updateData.gmailHistoryId = String(historyId);
      console.log(`[Gmail Watch] Initial historyId set to ${historyId} for account ${connectedAccountId}`);
    } else {
      console.log(`[Gmail Watch] Preserved existing historyId=${account.gmailHistoryId} (watch returned ${historyId}) for account ${connectedAccountId}`);
    }
    await prisma.connectedAccount.update({
      where: { id: connectedAccountId },
      data: updateData,
    });
  }

  console.log(`[Gmail Watch] Started for account ${connectedAccountId}, expires=${expirationDate.toISOString()}, labelFilter=include [INBOX,SENT]`);
  return { historyId: String(historyId), expiration: expirationDate };
}

/**
 * Stop watching a Gmail mailbox.
 */
export async function stopWatch(connectedAccountId) {
  try {
    const gmail = await getGmailClient(connectedAccountId);
    await gmail.users.stop({ userId: 'me' });
    await prisma.connectedAccount.update({
      where: { id: connectedAccountId },
      data: { gmailHistoryId: null, gmailWatchExpiration: null },
    });
    evictGmailClient(connectedAccountId);
    console.log(`[Gmail Watch] Stopped for account ${connectedAccountId}`);
  } catch (err) {
    console.error(`[Gmail Watch] Stop failed for ${connectedAccountId}:`, err.message);
  }
}

/**
 * Fetch new messages since a given historyId using the History API.
 * Returns an array of full message objects.
 * Handles pagination to ensure no messages are missed.
 */
export async function fetchHistoryMessages(connectedAccountId, startHistoryId) {
  const gmail = await getGmailClient(connectedAccountId);

  // Paginate through all history records since startHistoryId.
  // Use BOTH messageAdded and labelAdded to catch:
  //   - New inbound emails (messageAdded)
  //   - Emails sent from phone/Gmail web (may appear as labelAdded with SENT label)
  const messageIds = new Set();
  let pageToken = undefined;
  let newHistoryId = null;
  let pageCount = 0;

  do {
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded', 'labelAdded'],
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    const histories = historyRes.data.history || [];
    newHistoryId = historyRes.data.historyId;
    pageToken = historyRes.data.nextPageToken;
    pageCount++;

    for (const record of histories) {
      // Capture newly added messages (inbound + some outbound)
      for (const added of record.messagesAdded || []) {
        const msgId = added.message.id;
        const labels = added.message.labelIds || [];
        messageIds.add(msgId);
        console.log(`[Gmail History] messageAdded: ${msgId}, labels=[${labels.join(',')}]`);
      }

      // Capture label changes — emails sent from phone often show up as
      // labelAdded (SENT/INBOX) rather than messageAdded
      for (const labeled of record.labelsAdded || []) {
        const addedLabels = labeled.labelIds || [];
        const isRelevant = addedLabels.some((l) => ['SENT', 'INBOX'].includes(l));
        if (isRelevant) {
          const msgId = labeled.message.id;
          messageIds.add(msgId);
          console.log(`[Gmail History] labelAdded: ${msgId}, addedLabels=[${addedLabels.join(',')}]`);
        }
      }
    }
  } while (pageToken);

  if (pageCount > 1) {
    console.log(`[Gmail History] Paginated through ${pageCount} pages of history`);
  }

  if (messageIds.size === 0) {
    return { messages: [], newHistoryId };
  }

  console.log(`[Gmail History] Fetching full details for ${messageIds.size} message(s)`);

  // Fetch full message details in parallel
  const messages = await Promise.all(
    [...messageIds].map(async (id) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });
        const labels = msgRes.data.labelIds || [];
        const from = (msgRes.data.payload?.headers || []).find(h => h.name === 'From')?.value || 'unknown';
        console.log(`[Gmail History] Message ${id}: labels=[${labels.join(',')}], from=${from}`);
        return msgRes.data;
      } catch (err) {
        console.warn(`[Gmail History] Could not fetch message ${id}: ${err.message}`);
        return null; // Message may have been deleted
      }
    })
  );

  return {
    messages: messages.filter(Boolean),
    newHistoryId,
  };
}

/**
 * Renew watches for all active Gmail accounts whose watch is about to expire.
 * Call this periodically (e.g. every 6 hours).
 */
export async function renewExpiringWatches() {
  const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000); // expires within 24h
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      platform: 'gmail',
      status: 'active',
      gmailWatchExpiration: { lt: threshold },
    },
  });

  console.log(`[Gmail Watch] Renewing ${accounts.length} expiring watches`);
  for (const account of accounts) {
    try {
      await startWatch(account.id);
    } catch (err) {
      console.error(`[Gmail Watch] Renewal failed for ${account.id}:`, err.message);
    }
  }
}

/**
 * Re-register watches for ALL active Gmail accounts.
 * Call once on startup to ensure watch config (label filters) is up to date.
 */
export async function reRegisterAllWatches() {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      platform: 'gmail',
      status: 'active',
      gmailHistoryId: { not: null },
    },
  });

  console.log(`[Gmail Watch] Re-registering watches for ${accounts.length} active account(s)`);
  for (const account of accounts) {
    try {
      await startWatch(account.id);
    } catch (err) {
      console.error(`[Gmail Watch] Re-register failed for ${account.id}:`, err.message);
    }
  }
}

export function parseEmailHeaders(headers) {
  const result = {};
  for (const header of headers) {
    result[header.name.toLowerCase()] = header.value;
  }
  return result;
}

export function getEmailBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  if (payload.parts) {
    // First pass: look for text/plain at any nesting level
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      // Recurse into multipart/alternative or multipart/mixed
      if (part.parts) {
        for (const subPart of part.parts) {
          if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
            return Buffer.from(subPart.body.data, 'base64url').toString('utf8');
          }
        }
      }
    }
    // Second pass: fall back to text/html at any nesting level
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      if (part.parts) {
        for (const subPart of part.parts) {
          if (subPart.mimeType === 'text/html' && subPart.body?.data) {
            return Buffer.from(subPart.body.data, 'base64url').toString('utf8');
          }
        }
      }
    }
  }
  return '';
}

export function getEmailHtmlBody(payload) {
  // Recursively search for text/html at any depth
  function findHtml(node) {
    if (!node) return null;
    if (node.mimeType === 'text/html' && node.body?.data) {
      return Buffer.from(node.body.data, 'base64url').toString('utf8');
    }
    if (node.parts) {
      for (const part of node.parts) {
        const result = findHtml(part);
        if (result) return result;
      }
    }
    return null;
  }
  return findHtml(payload);
}

export function getEmailAttachments(payload) {
  const attachments = [];
  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }
  walk(payload.parts);
  return attachments;
}
