import axios from 'axios';
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
