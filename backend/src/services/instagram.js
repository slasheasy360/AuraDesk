import axios from 'axios';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export function getLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${process.env.NGROK_URL || 'http://localhost:3001'}/auth/instagram/callback`,
    scope: 'pages_show_list,pages_manage_metadata,instagram_basic,instagram_manage_messages',
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function handleCallback(code, userId) {
  // Exchange code for token
  const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: `${process.env.NGROK_URL || 'http://localhost:3001'}/auth/instagram/callback`,
      code,
    },
  });

  const userToken = tokenRes.data.access_token;

  // Exchange for long-lived token
  const longLivedRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: userToken,
    },
  });

  const longLivedToken = longLivedRes.data.access_token;

  // Get user's pages
  const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: { access_token: longLivedToken },
  });

  const pages = pagesRes.data.data || [];

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
        break;
      }
    } catch {
      continue;
    }
  }

  if (!igAccount || !linkedPage) {
    throw new Error('No Instagram Business Account found linked to any Facebook Page.');
  }

  // Subscribe to Instagram webhook events
  await axios.post(`${GRAPH_API}/${linkedPage.id}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'messages,messaging_postbacks',
      access_token: linkedPage.access_token,
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

  // Store page token (used for Instagram messaging)
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
