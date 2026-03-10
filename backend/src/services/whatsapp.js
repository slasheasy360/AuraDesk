import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

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

  // Subscribe webhook to WABA for this tenant (non-fatal — can be configured manually in Meta dashboard)
  try {
    await axios.post(`${GRAPH_API}/${wabaId}/subscribed_apps`, null, {
      params: { access_token: userAccessToken },
    });
    console.log('[WhatsApp] Webhook subscription successful for WABA:', wabaId);
  } catch (err) {
    console.warn('[WhatsApp] Webhook subscription failed (non-fatal):', err.response?.data?.error?.message || err.message);
    // (#200) Permissions error can happen — webhook can be configured manually in Meta dashboard
  }

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
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', fs.createReadStream(file.path), {
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

  return res.data;
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
