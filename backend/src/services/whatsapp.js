import axios from 'axios';
import prisma from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export async function handleEmbeddedSignup(userId, wabaId, phoneNumberId, userAccessToken) {
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

  // Subscribe webhook to WABA (non-fatal — works without it if configured manually in dashboard)
  try {
    await axios.post(`${GRAPH_API}/${wabaId}/subscribed_apps`, null, {
      params: { access_token: userAccessToken },
    });
    console.log('[WhatsApp] Webhook subscription successful');
  } catch {
    // (#200) Permissions error is expected for system user tokens — webhook can be configured manually in Meta dashboard instead
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
      tokenType: 'system_user',
      scopes: 'whatsapp_business_messaging',
    },
    create: {
      connectedAccountId: connectedAccount.id,
      accessTokenEncrypted: encrypt(userAccessToken),
      tokenType: 'system_user',
      scopes: 'whatsapp_business_messaging',
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
