import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const DEFAULT_INSTAGRAM_REDIRECT_URI = 'https://auradesk-k5en.onrender.com/auth/instagram/callback';

function getInstagramRedirectUri() {
  return process.env.INSTAGRAM_REDIRECT_URI || DEFAULT_INSTAGRAM_REDIRECT_URI;
}

export function getLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: getInstagramRedirectUri(),
    scope: 'pages_show_list,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages',
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function handleCallback(code, userId) {
  console.log('[Instagram OAuth] Exchanging code for access token...');
  const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: getInstagramRedirectUri(),
      code,
    },
  });

  const userToken = tokenRes.data.access_token;
  console.log('[Instagram OAuth] Token exchange successful');

  // Exchange for long-lived token
  console.log('[Instagram OAuth] Exchanging for long-lived token...');
  const longLivedRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: userToken,
    },
  });

  const longLivedToken = longLivedRes.data.access_token;
  console.log('[Instagram OAuth] Long-lived token obtained');

  // Get user's pages
  console.log('[Instagram OAuth] Fetching /me/accounts...');
  const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: {
      fields: 'id,name,access_token',
      access_token: longLivedToken,
    },
  });

  const pages = pagesRes.data.data || [];
  console.log('[Instagram OAuth] Pages found:', pages.length);

  // Find page with linked Instagram Business Account
  let igAccount = null;
  let linkedPage = null;

  for (const page of pages) {
    try {
      const res = await axios.get(`${GRAPH_API}/${page.id}`, {
        params: {
          fields: 'instagram_business_account{id,username,name,profile_picture_url}',
          access_token: page.access_token,
        },
      });
      if (res.data.instagram_business_account) {
        igAccount = res.data.instagram_business_account;
        linkedPage = page;
        console.log('[Instagram OAuth] Found IG account on page', {
          pageId: page.id,
          pageName: page.name,
          igId: igAccount.id,
          igUsername: igAccount.username,
        });
        break;
      }
    } catch {
      continue;
    }
  }

  if (!igAccount || !linkedPage) {
    throw new Error('No Instagram Business Account found linked to any Facebook Page.');
  }

  // Subscribe to webhook events for Instagram messages
  console.log('[Instagram OAuth] Subscribing page to webhook...');
  try {
    await axios.post(`${GRAPH_API}/${linkedPage.id}/subscribed_apps`, null, {
      params: {
        subscribed_fields: 'messages,messaging_postbacks',
        access_token: linkedPage.access_token,
      },
    });
    console.log('[Instagram OAuth] Webhook subscription successful');
  } catch (subErr) {
    console.error('[Instagram OAuth] Webhook subscription failed:', subErr.response?.data || subErr.message);
  }

  // Deactivate any OTHER user's active connection for the same Instagram account
  // so webhooks route messages to the new owner
  const previousConnections = await prisma.connectedAccount.findMany({
    where: {
      platform: 'instagram',
      platformAccountId: igAccount.id,
      status: 'active',
      userId: { not: userId },
    },
  });
  for (const prev of previousConnections) {
    console.log('[Instagram OAuth] Deactivating previous connection', { prevAccountId: prev.id, prevUserId: prev.userId });
    await prisma.authToken.deleteMany({ where: { connectedAccountId: prev.id } });
    await prisma.webhookSubscription.deleteMany({ where: { connectedAccountId: prev.id } });
    await prisma.connectedAccount.update({
      where: { id: prev.id },
      data: { status: 'disconnected' },
    });
  }

  // Clean up any previous disconnected sessions for this user + IG account
  await prisma.connectedAccount.deleteMany({
    where: {
      userId,
      platform: 'instagram',
      platformAccountId: igAccount.id,
      status: 'disconnected',
    },
  });

  // Upsert connected account
  const connectedAccount = await prisma.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId,
        platform: 'instagram',
        platformAccountId: igAccount.id,
      },
    },
    update: {
      displayName: igAccount.username || igAccount.name,
      avatarUrl: igAccount.profile_picture_url,
      status: 'active',
    },
    create: {
      userId,
      platform: 'instagram',
      platformAccountId: igAccount.id,
      displayName: igAccount.username || igAccount.name,
      avatarUrl: igAccount.profile_picture_url,
      status: 'active',
    },
  });

  // Store page token (used for Instagram messaging API)
  await prisma.authToken.upsert({
    where: { connectedAccountId: connectedAccount.id },
    update: {
      accessTokenEncrypted: encrypt(linkedPage.access_token),
      refreshTokenEncrypted: encrypt(longLivedToken),
      tokenType: 'page_token',
      scopes: 'instagram_manage_messages',
    },
    create: {
      connectedAccountId: connectedAccount.id,
      accessTokenEncrypted: encrypt(linkedPage.access_token),
      refreshTokenEncrypted: encrypt(longLivedToken),
      tokenType: 'page_token',
      scopes: 'instagram_manage_messages',
    },
  });

  // Record webhook subscription in database
  await prisma.webhookSubscription.upsert({
    where: {
      id: (
        await prisma.webhookSubscription.findFirst({
          where: { connectedAccountId: connectedAccount.id, platform: 'instagram' },
        })
      )?.id || 'non-existent-id',
    },
    update: {
      subscribedFields: 'messages,messaging_postbacks',
      verifiedAt: new Date(),
    },
    create: {
      connectedAccountId: connectedAccount.id,
      platform: 'instagram',
      subscribedFields: 'messages,messaging_postbacks',
      verifiedAt: new Date(),
    },
  });

  console.log('[Instagram OAuth] ✓ Instagram account connected', {
    accountId: connectedAccount.id,
    igId: igAccount.id,
    username: igAccount.username,
  });

  return connectedAccount;
}

export async function sendMessage(connectedAccountId, recipientId, text) {
  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const pageToken = decrypt(authToken.accessTokenEncrypted);

  const res = await axios.post(
    `${GRAPH_API}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    },
    {
      params: { access_token: pageToken },
    }
  );

  return res.data;
}

export async function sendAttachment(connectedAccountId, recipientId, file) {
  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const pageToken = decrypt(authToken.accessTokenEncrypted);

  // Instagram DM supports image attachments
  let type = 'file';
  if (file.mimetype.startsWith('image/')) type = 'image';
  else if (file.mimetype.startsWith('video/')) type = 'video';
  else if (file.mimetype.startsWith('audio/')) type = 'audio';

  const form = new FormData();
  form.append('recipient', JSON.stringify({ id: recipientId }));
  form.append('messaging_type', 'RESPONSE');
  form.append('message', JSON.stringify({
    attachment: { type, payload: { is_reusable: false } },
  }));
  form.append('filedata', fs.createReadStream(file.path), {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  const res = await axios.post(`${GRAPH_API}/me/messages`, form, {
    params: { access_token: pageToken },
    headers: form.getHeaders(),
    maxContentLength: 26214400,
  });

  return res.data;
}
