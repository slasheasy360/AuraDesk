import axios from 'axios';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const DEFAULT_FACEBOOK_REDIRECT_URI = 'https://auradesk-k5en.onrender.com/auth/facebook/callback';

function getMetaAppId() {
  if (!process.env.META_APP_ID) {
    throw new Error('META_APP_ID is not configured');
  }
  return process.env.META_APP_ID;
}

function getMetaAppSecret() {
  if (!process.env.META_APP_SECRET) {
    throw new Error('META_APP_SECRET is not configured');
  }
  return process.env.META_APP_SECRET;
}

function getFacebookRedirectUri() {
  return process.env.FACEBOOK_REDIRECT_URI || DEFAULT_FACEBOOK_REDIRECT_URI;
}

export function encodeConnectState(userId) {
  return Buffer.from(JSON.stringify({ userId, mode: 'connect' })).toString('base64url');
}

export function decodeConnectState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    throw new Error('Invalid OAuth state payload');
  }
}

export function getLoginUrl(state, scope = 'pages_show_list,pages_manage_metadata,pages_messaging,business_management') {
  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    redirect_uri: getFacebookRedirectUri(),
    scope,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function exchangeCodeForAccessToken(code) {
  if (!code) {
    throw new Error('Missing authorization code');
  }

  const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: getMetaAppId(),
      client_secret: getMetaAppSecret(),
      redirect_uri: getFacebookRedirectUri(),
      code,
    },
  });

  return tokenRes.data;
}

export async function handleCallback(code, userId) {
  // Exchange code for short-lived token
  const tokenResponse = await exchangeCodeForAccessToken(code);
  const shortLivedToken = tokenResponse.access_token;

  return handleCallbackWithToken(shortLivedToken, userId);
}

export async function handleCallbackWithToken(shortLivedToken, userId) {
  if (!shortLivedToken) {
    throw new Error('Missing Facebook access token');
  }

  if (!userId) {
    throw new Error('Missing userId for Facebook OAuth callback');
  }

  // Exchange for long-lived token (60 days)
  const longLivedRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: getMetaAppId(),
      client_secret: getMetaAppSecret(),
      fb_exchange_token: shortLivedToken,
    },
  });

  const longLivedToken = longLivedRes.data.access_token;
  const expiresIn = longLivedRes.data.expires_in; // seconds

  // Get user's pages
  const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: { access_token: longLivedToken },
  });

  const pages = pagesRes.data.data;
  if (!pages || pages.length === 0) {
    throw new Error('No Facebook Pages found. User must have a Facebook Page to connect.');
  }

  // For POC: connect the first page. In production, let user choose.
  const page = pages[0];

  // Get page access token (doesn't expire when obtained from long-lived user token)
  const pageTokenRes = await axios.get(`${GRAPH_API}/${page.id}`, {
    params: {
      fields: 'access_token,name,picture',
      access_token: longLivedToken,
    },
  });

  const pageAccessToken = pageTokenRes.data.access_token;

  // Subscribe page to webhook
  await axios.post(`${GRAPH_API}/${page.id}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'messages,message_reads,message_deliveries,messaging_postbacks',
      access_token: pageAccessToken,
    },
  });

  // Upsert connected account
  const connectedAccount = await prisma.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId,
        platform: 'facebook',
        platformAccountId: page.id,
      },
    },
    update: {
      displayName: page.name,
      status: 'active',
    },
    create: {
      userId,
      platform: 'facebook',
      platformAccountId: page.id,
      displayName: page.name,
      status: 'active',
    },
  });

  // Store page access token encrypted
  await prisma.authToken.upsert({
    where: { connectedAccountId: connectedAccount.id },
    update: {
      accessTokenEncrypted: encrypt(pageAccessToken),
      refreshTokenEncrypted: encrypt(longLivedToken),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      tokenType: 'page_token',
      scopes: 'pages_messaging',
    },
    create: {
      connectedAccountId: connectedAccount.id,
      accessTokenEncrypted: encrypt(pageAccessToken),
      refreshTokenEncrypted: encrypt(longLivedToken),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      tokenType: 'page_token',
      scopes: 'pages_messaging',
    },
  });

  return { connectedAccount, pages };
}

export async function sendMessage(connectedAccountId, recipientPsid, text) {
  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const pageAccessToken = decrypt(authToken.accessTokenEncrypted);

  const res = await axios.post(
    `${GRAPH_API}/me/messages`,
    {
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { text },
    },
    {
      params: { access_token: pageAccessToken },
    }
  );

  return res.data;
}

export async function getUserProfile(pageAccessToken, psid) {
  try {
    const res = await axios.get(`${GRAPH_API}/${psid}`, {
      params: {
        fields: 'first_name,last_name,profile_pic',
        access_token: pageAccessToken,
      },
    });
    return res.data;
  } catch {
    return { first_name: 'Unknown', last_name: 'User' };
  }
}
