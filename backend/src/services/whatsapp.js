import axios from 'axios';
import FormData from 'form-data';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function maskEmail(email) {
  const [local, domain] = email.split('@');
  const visible = local.substring(0, 5);
  const masked = '*'.repeat(Math.max(local.length - 5, 0));
  return `${visible}${masked}@${domain}`;
}

export async function handleEmbeddedSignup(userId, wabaId, phoneNumberId, userAccessToken, tokenType = 'user') {
  // Get phone number details
  let phoneNumber = phoneNumberId;
  let businessName = 'WhatsApp Business';

  try {
    const phoneRes = await axios.get(`${GRAPH_API}/${phoneNumberId}`, {
      params: {
        fields: 'display_phone_number,verified_name',
        access_token: userAccessToken,
      },
    });
    phoneNumber = phoneRes.data.display_phone_number || phoneNumber;
    businessName = phoneRes.data.verified_name || businessName;
    console.log('[WhatsApp] Phone details:', { phoneNumber, businessName });
  } catch (err) {
    console.warn('[WhatsApp] Could not fetch phone details (non-fatal):', err.response?.data?.error?.message || err.message);
  }

  // Helper: subscribe webhook (non-fatal, can be configured manually in Meta dashboard)
  async function subscribeWebhook() {
    try {
      await axios.post(`${GRAPH_API}/${wabaId}/subscribed_apps`, null, {
        params: { access_token: userAccessToken, subscribed_fields: 'messages' },
      });
      console.log('[WhatsApp] Webhook subscription successful for WABA:', wabaId);
    } catch (err) {
      console.warn('[WhatsApp] Webhook subscription failed (non-fatal):', err.response?.data?.error?.message || err.message);
    }
  }

  // ── Case 1: Existing active WhatsApp account for this user with this phone ──
  // Update in place instead of delete+recreate — preserves all conversation history.
  const myExistingWhatsapp = await prisma.whatsappAccount.findFirst({
    where: {
      OR: [
        { phoneNumberId },
        ...(phoneNumber !== phoneNumberId ? [{ phoneNumber }] : []),
      ],
      connectedAccount: { userId },
    },
    include: { connectedAccount: true },
  });

  if (myExistingWhatsapp) {
    console.log('[WhatsApp] Reconnecting existing account — preserving history, phoneNumberId:', phoneNumberId);
    const [updatedAccount] = await Promise.all([
      prisma.connectedAccount.update({
        where: { id: myExistingWhatsapp.connectedAccountId },
        data: { status: 'active', displayName: businessName || phoneNumber },
      }),
      prisma.whatsappAccount.update({
        where: { id: myExistingWhatsapp.id },
        data: { wabaId, phoneNumberId, phoneNumber, businessName, webhookVerified: true },
      }),
      prisma.authToken.upsert({
        where: { connectedAccountId: myExistingWhatsapp.connectedAccountId },
        update: { accessTokenEncrypted: encrypt(userAccessToken), tokenType, scopes: 'whatsapp_business_messaging,whatsapp_business_management' },
        create: { connectedAccountId: myExistingWhatsapp.connectedAccountId, accessTokenEncrypted: encrypt(userAccessToken), tokenType, scopes: 'whatsapp_business_messaging,whatsapp_business_management' },
      }),
    ]);
    await subscribeWebhook();
    return updatedAccount;
  }

  // ── Check if this phone is already connected to a DIFFERENT user/workspace ──
  const existingWhatsapp = await prisma.whatsappAccount.findFirst({
    where: {
      OR: [
        { phoneNumberId },
        ...(phoneNumber !== phoneNumberId ? [{ phoneNumber }] : []),
      ],
      connectedAccount: {
        status: 'active',
        userId: { not: userId },
      },
    },
    include: {
      connectedAccount: {
        include: { user: true },
      },
    },
  });

  if (existingWhatsapp) {
    const ownerEmail = existingWhatsapp.connectedAccount.user.email;
    const maskedEmail = maskEmail(ownerEmail);
    const error = new Error(`This phone number is already connected with another account: ${maskedEmail}`);
    error.code = 'DUPLICATE_PHONE';
    throw error;
  }

  // ── Case 2: Reconnect after explicit disconnect ──
  // The whatsappAccount was deleted on disconnect but connectedAccount still exists
  // with status='disconnected'. Reactivating preserves all conversation history.
  const disconnectedAccount = await prisma.connectedAccount.findFirst({
    where: { userId, platform: 'whatsapp', platformAccountId: wabaId, status: 'disconnected' },
  });

  if (disconnectedAccount) {
    console.log('[WhatsApp] Reactivating disconnected account — preserving conversation history, wabaId:', wabaId);
    const [updatedAccount] = await Promise.all([
      prisma.connectedAccount.update({
        where: { id: disconnectedAccount.id },
        data: { status: 'active', displayName: businessName || phoneNumber },
      }),
      prisma.whatsappAccount.upsert({
        where: { connectedAccountId: disconnectedAccount.id },
        update: { wabaId, phoneNumberId, phoneNumber, businessName, webhookVerified: true },
        create: { connectedAccountId: disconnectedAccount.id, wabaId, phoneNumberId, phoneNumber, businessName, webhookVerified: true },
      }),
      prisma.authToken.upsert({
        where: { connectedAccountId: disconnectedAccount.id },
        update: { accessTokenEncrypted: encrypt(userAccessToken), tokenType, scopes: 'whatsapp_business_messaging,whatsapp_business_management' },
        create: { connectedAccountId: disconnectedAccount.id, accessTokenEncrypted: encrypt(userAccessToken), tokenType, scopes: 'whatsapp_business_messaging,whatsapp_business_management' },
      }),
    ]);
    await subscribeWebhook();
    return updatedAccount;
  }

  // ── Case 3: Fresh connection — no existing account for this user + phone ──
  await subscribeWebhook();

  // Upsert connected account
  const connectedAccount = await prisma.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId,
        platform: 'whatsapp',
        platformAccountId: wabaId,
      },
    },
    update: {
      displayName: businessName || phoneNumber,
      status: 'active',
    },
    create: {
      userId,
      platform: 'whatsapp',
      platformAccountId: wabaId,
      displayName: businessName || phoneNumber,
      status: 'active',
    },
  });

  // Store WhatsApp-specific details
  await prisma.whatsappAccount.upsert({
    where: { connectedAccountId: connectedAccount.id },
    update: {
      wabaId,
      phoneNumberId,
      phoneNumber,
      businessName,
      webhookVerified: true,
    },
    create: {
      connectedAccountId: connectedAccount.id,
      wabaId,
      phoneNumberId,
      phoneNumber,
      businessName,
      webhookVerified: true,
    },
  });

  // Store token encrypted
  await prisma.authToken.upsert({
    where: { connectedAccountId: connectedAccount.id },
    update: {
      accessTokenEncrypted: encrypt(userAccessToken),
      tokenType,
      scopes: 'whatsapp_business_messaging,whatsapp_business_management',
    },
    create: {
      connectedAccountId: connectedAccount.id,
      accessTokenEncrypted: encrypt(userAccessToken),
      tokenType,
      scopes: 'whatsapp_business_messaging,whatsapp_business_management',
    },
  });

  return connectedAccount;
}

export async function sendMessage(connectedAccountId, toPhoneNumber, text) {
  const whatsappAccount = await prisma.whatsappAccount.findUnique({
    where: { connectedAccountId },
    include: { connectedAccount: { include: { authToken: true } } },
  });

  if (!whatsappAccount) throw new Error('WhatsApp account not found');

  const authToken = whatsappAccount.connectedAccount.authToken;
  if (!authToken) throw new Error('No auth token found');

  const accessToken = decrypt(authToken.accessTokenEncrypted);

  const res = await axios.post(
    `${GRAPH_API}/${whatsappAccount.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhoneNumber,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return res.data;
}

export async function sendMedia(connectedAccountId, toPhoneNumber, file) {
  const whatsappAccount = await prisma.whatsappAccount.findUnique({
    where: { connectedAccountId },
    include: { connectedAccount: { include: { authToken: true } } },
  });

  if (!whatsappAccount) throw new Error('WhatsApp account not found');

  const authToken = whatsappAccount.connectedAccount.authToken;
  if (!authToken) throw new Error('No auth token found');

  const accessToken = decrypt(authToken.accessTokenEncrypted);

  // Step 1: Upload media to WhatsApp
  // multer uses memoryStorage so file.buffer is available; file.path does not exist.
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  const uploadRes = await axios.post(
    `${GRAPH_API}/${whatsappAccount.phoneNumberId}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
    }
  );

  const mediaId = uploadRes.data.id;

  // Step 2: Determine media type
  let mediaType = 'document';
  if (file.mimetype.startsWith('image/')) mediaType = 'image';
  else if (file.mimetype.startsWith('video/')) mediaType = 'video';
  else if (file.mimetype.startsWith('audio/')) mediaType = 'audio';

  // Step 3: Send the media message
  const messagePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toPhoneNumber,
    type: mediaType,
    [mediaType]: { id: mediaId },
  };

  // Add filename for documents
  if (mediaType === 'document') {
    messagePayload.document.filename = file.originalname;
  }

  const res = await axios.post(
    `${GRAPH_API}/${whatsappAccount.phoneNumberId}/messages`,
    messagePayload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return { ...res.data, mediaId };
}

/**
 * Get the download URL for a WhatsApp media file.
 * WhatsApp media IDs must be resolved to a temporary URL via the Graph API.
 */
export async function getMediaUrl(connectedAccountId, mediaId) {
  const whatsappAccount = await prisma.whatsappAccount.findUnique({
    where: { connectedAccountId },
    include: { connectedAccount: { include: { authToken: true } } },
  });

  if (!whatsappAccount) throw new Error('WhatsApp account not found');
  const authToken = whatsappAccount.connectedAccount.authToken;
  if (!authToken) throw new Error('No auth token found');

  const accessToken = decrypt(authToken.accessTokenEncrypted);

  // Step 1: Get the media URL from WhatsApp
  const mediaRes = await axios.get(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const mediaUrl = mediaRes.data.url;
  if (!mediaUrl) throw new Error('No URL returned for media ID');

  return { url: mediaUrl, accessToken, mimeType: mediaRes.data.mime_type };
}

/**
 * Download WhatsApp media binary data.
 * Returns a readable stream and content type.
 */
export async function downloadMedia(connectedAccountId, mediaId) {
  const { url, accessToken, mimeType } = await getMediaUrl(connectedAccountId, mediaId);

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'stream',
  });

  return {
    stream: response.data,
    contentType: mimeType || response.headers['content-type'],
    contentLength: response.headers['content-length'],
  };
}

export async function findAccountByPhoneNumberId(phoneNumberId) {
  return prisma.whatsappAccount.findFirst({
    where: { phoneNumberId },
    include: {
      connectedAccount: {
        include: { user: true },
      },
    },
  });
}
