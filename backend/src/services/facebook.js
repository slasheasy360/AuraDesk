import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
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

export function getLoginUrl(state) {
  // Request only Facebook Messenger scopes — Instagram has its own separate OAuth flow
  const scope = [
    'pages_show_list',
    'pages_manage_metadata',
    'pages_messaging',
    'pages_read_engagement',
    'business_management',
  ].join(',');

  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    redirect_uri: getFacebookRedirectUri(),
    scope,
    response_type: 'code',
    state,
    auth_type: 'rerequest',
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function exchangeCodeForAccessToken(code) {
  if (!code) {
    throw new Error('Missing authorization code');
  }

  console.log('[Facebook OAuth] Exchanging code for access token...');
  const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: getMetaAppId(),
      client_secret: getMetaAppSecret(),
      redirect_uri: getFacebookRedirectUri(),
      code,
    },
  });

  console.log('[Facebook OAuth] Token exchange successful', {
    hasAccessToken: Boolean(tokenRes.data.access_token),
    expiresIn: tokenRes.data.expires_in || 'none',
  });

  return tokenRes.data;
}

export async function handleCallback(code, userId) {
  const tokenResponse = await exchangeCodeForAccessToken(code);
  return handleCallbackWithToken(tokenResponse.access_token, userId);
}

export async function handleCallbackWithToken(shortLivedToken, userId) {
  if (!shortLivedToken) {
    throw new Error('Missing Facebook access token');
  }
  if (!userId) {
    throw new Error('Missing userId for Facebook OAuth callback');
  }

  // ── Step 1: Exchange for long-lived user token (60 days) ──
  console.log('[Facebook OAuth] Step 1: Exchanging for long-lived token...');
  const longLivedRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: getMetaAppId(),
      client_secret: getMetaAppSecret(),
      fb_exchange_token: shortLivedToken,
    },
  });

  const longLivedToken = longLivedRes.data.access_token;
  const userTokenExpiresIn = longLivedRes.data.expires_in;
  console.log('[Facebook OAuth] Step 1 complete: long-lived token obtained', {
    expiresIn: userTokenExpiresIn,
  });

  // ── Step 1b: Check granted permissions ──
  console.log('[Facebook OAuth] Step 1b: Checking granted permissions...');
  try {
    const permsRes = await axios.get(`${GRAPH_API}/me/permissions`, {
      params: { access_token: longLivedToken },
    });
    console.log('[Facebook OAuth] Granted permissions:', JSON.stringify(permsRes.data.data));
  } catch (permErr) {
    console.warn('[Facebook OAuth] Could not check permissions:', permErr.message);
  }

  // ── Step 1c: Get user info ──
  try {
    const meRes = await axios.get(`${GRAPH_API}/me`, {
      params: { fields: 'id,name', access_token: longLivedToken },
    });
    console.log('[Facebook OAuth] Authenticated user:', meRes.data);
  } catch (meErr) {
    console.warn('[Facebook OAuth] Could not fetch /me:', meErr.message);
  }

  // ── Step 2: Fetch user's Facebook Pages ──
  console.log('[Facebook OAuth] Step 2: Fetching /me/accounts...');
  const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: {
      fields: 'id,name,access_token,picture',
      access_token: longLivedToken,
    },
  });

  console.log('[Facebook OAuth] Step 2 raw response:', JSON.stringify(pagesRes.data));
  const pages = pagesRes.data.data;
  console.log('[Facebook OAuth] Step 2 complete: pages found', {
    count: pages?.length || 0,
    pages: pages?.map((p) => ({ id: p.id, name: p.name })) || [],
  });

  if (!pages || pages.length === 0) {
    throw new Error(
      'No Facebook Pages found. Make sure: (1) You are admin of a Facebook Page, (2) Your Meta app has pages_show_list permission, (3) You granted page access during OAuth. Raw response: ' +
        JSON.stringify(pagesRes.data)
    );
  }

  // For POC: connect the first page. In production, let user choose.
  const page = pages[0];
  const pageAccessToken = page.access_token; // already a page token from /me/accounts

  console.log('[Facebook OAuth] Selected page:', { id: page.id, name: page.name });

  // ── Step 3: Subscribe the Page to webhook events ──
  console.log('[Facebook OAuth] Step 3: Subscribing page to webhook...');
  try {
    const subRes = await axios.post(`${GRAPH_API}/${page.id}/subscribed_apps`, null, {
      params: {
        subscribed_fields: 'messages,message_reads,message_deliveries,messaging_postbacks,feed',
        access_token: pageAccessToken,
      },
    });
    console.log('[Facebook OAuth] Step 3 complete: webhook subscription response', subRes.data);
  } catch (subErr) {
    console.error('[Facebook OAuth] Step 3 FAILED: webhook subscription error', {
      status: subErr.response?.status,
      data: subErr.response?.data,
      message: subErr.message,
    });
    // Don't throw — continue to save the account. Webhook can be re-subscribed later.
  }

  // ── Step 4: Save Facebook Page connected account + token ──
  console.log('[Facebook OAuth] Step 4: Saving Facebook connected account...');
  const fbAccount = await prisma.connectedAccount.upsert({
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

  await prisma.authToken.upsert({
    where: { connectedAccountId: fbAccount.id },
    update: {
      accessTokenEncrypted: encrypt(pageAccessToken),
      refreshTokenEncrypted: encrypt(longLivedToken),
      expiresAt: userTokenExpiresIn
        ? new Date(Date.now() + userTokenExpiresIn * 1000)
        : null,
      tokenType: 'page_token',
      scopes: 'pages_messaging,pages_manage_metadata',
    },
    create: {
      connectedAccountId: fbAccount.id,
      accessTokenEncrypted: encrypt(pageAccessToken),
      refreshTokenEncrypted: encrypt(longLivedToken),
      expiresAt: userTokenExpiresIn
        ? new Date(Date.now() + userTokenExpiresIn * 1000)
        : null,
      tokenType: 'page_token',
      scopes: 'pages_messaging,pages_manage_metadata',
    },
  });

  // Record webhook subscription
  await prisma.webhookSubscription.upsert({
    where: {
      id: (
        await prisma.webhookSubscription.findFirst({
          where: { connectedAccountId: fbAccount.id, platform: 'facebook' },
        })
      )?.id || 'non-existent-id',
    },
    update: {
      subscribedFields: 'messages,message_reads,message_deliveries,messaging_postbacks,feed',
      verifiedAt: new Date(),
    },
    create: {
      connectedAccountId: fbAccount.id,
      platform: 'facebook',
      subscribedFields: 'messages,message_reads,message_deliveries,messaging_postbacks,feed',
      verifiedAt: new Date(),
    },
  });

  console.log('[Facebook OAuth] Step 4 complete: Facebook account saved', {
    accountId: fbAccount.id,
    pageId: page.id,
    pageName: page.name,
  });

  console.log('[Facebook OAuth] ✓ Full OAuth flow completed for user', userId);
  return { connectedAccount: fbAccount, pages };
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

export async function sendAttachment(connectedAccountId, recipientPsid, file) {
  const authToken = await prisma.authToken.findUnique({
    where: { connectedAccountId },
  });
  if (!authToken) throw new Error('No auth token found');

  const pageAccessToken = decrypt(authToken.accessTokenEncrypted);

  // Determine attachment type from mimetype
  let type = 'file';
  if (file.mimetype.startsWith('image/')) type = 'image';
  else if (file.mimetype.startsWith('video/')) type = 'video';
  else if (file.mimetype.startsWith('audio/')) type = 'audio';

  const form = new FormData();
  form.append('recipient', JSON.stringify({ id: recipientPsid }));
  form.append('messaging_type', 'RESPONSE');
  form.append('message', JSON.stringify({
    attachment: { type, payload: { is_reusable: false } },
  }));
  form.append('filedata', fs.createReadStream(file.path), {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  const res = await axios.post(`${GRAPH_API}/me/messages`, form, {
    params: { access_token: pageAccessToken },
    headers: form.getHeaders(),
    maxContentLength: 26214400,
  });

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
