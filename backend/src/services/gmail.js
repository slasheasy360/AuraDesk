import { google } from 'googleapis';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

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

export async function getGmailClient(connectedAccountId) {
  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const accessToken = decrypt(authToken.accessTokenEncrypted);
  const refreshToken = authToken.refreshTokenEncrypted ? decrypt(authToken.refreshTokenEncrypted) : null;
  const client = getAuthedClient(accessToken, refreshToken);

  // Listen for token refresh
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
  });

  return google.gmail({ version: 'v1', auth: client });
}

export async function fetchMessages(connectedAccountId, maxResults = 20) {
  const gmail = await getGmailClient(connectedAccountId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    labelIds: ['INBOX'],
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

export async function sendEmail(connectedAccountId, to, subject, body, threadId) {
  const gmail = await getGmailClient(connectedAccountId);

  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
  });

  // Get the Message-ID of the last message in the thread for proper In-Reply-To
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
    } catch {
      // If we can't fetch the thread, send without In-Reply-To
    }
  }

  const raw = createRawEmail(account.platformAccountId, to, subject, body, lastMessageId);

  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  return res.data;
}

function createRawEmail(from, to, subject, body, inReplyToMessageId) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];

  if (inReplyToMessageId) {
    headers.push(`In-Reply-To: ${inReplyToMessageId}`);
    headers.push(`References: ${inReplyToMessageId}`);
  }

  const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
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
      labelIds: ['INBOX'],
    },
  });

  const { historyId, expiration } = res.data;

  // Persist to DB
  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
  });
  if (account) {
    await prisma.connectedAccount.update({
      where: { id: connectedAccountId },
      data: {
        gmailHistoryId: String(historyId),
        gmailWatchExpiration: new Date(Number(expiration)),
      },
    });
  }

  console.log(`[Gmail Watch] Started for account ${connectedAccountId}, historyId=${historyId}, expires=${new Date(Number(expiration)).toISOString()}`);
  return { historyId: String(historyId), expiration: new Date(Number(expiration)) };
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
    console.log(`[Gmail Watch] Stopped for account ${connectedAccountId}`);
  } catch (err) {
    console.error(`[Gmail Watch] Stop failed for ${connectedAccountId}:`, err.message);
  }
}

/**
 * Fetch new messages since a given historyId using the History API.
 * Returns an array of full message objects.
 */
export async function fetchHistoryMessages(connectedAccountId, startHistoryId) {
  const gmail = await getGmailClient(connectedAccountId);

  const historyRes = await gmail.users.history.list({
    userId: 'me',
    startHistoryId,
    historyTypes: ['messageAdded'],
    labelId: 'INBOX',
  });

  const histories = historyRes.data.history || [];
  const newHistoryId = historyRes.data.historyId;

  // Collect unique message IDs from messagesAdded events
  const messageIds = new Set();
  for (const record of histories) {
    for (const added of record.messagesAdded || []) {
      messageIds.add(added.message.id);
    }
  }

  if (messageIds.size === 0) {
    return { messages: [], newHistoryId };
  }

  // Fetch full message details
  const messages = await Promise.all(
    [...messageIds].map(async (id) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });
        return msgRes.data;
      } catch {
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
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
    }
  }
  return '';
}
