import axios from 'axios';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Sync Facebook Messenger conversations for a user by polling the Conversations API.
 * Mirrors the pattern used by instagram.sync.js.
 */
export async function syncFacebookMessages(userId) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, platform: 'facebook', status: 'active' },
    include: { authToken: true },
  });

  if (accounts.length === 0) return [];

  const allNewMessages = [];

  for (const account of accounts) {
    if (!account.authToken) {
      console.warn('[Facebook Sync] No auth token for account:', account.id);
      continue;
    }

    const pageToken = decrypt(account.authToken.accessTokenEncrypted);
    const pageId = account.platformAccountId;

    try {
      const messages = await syncAccountConversations(account, pageId, pageToken, userId);
      allNewMessages.push(...messages);
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error('[Facebook Sync] Error syncing account:', account.id, errMsg);
    }
  }

  return allNewMessages;
}

async function syncAccountConversations(account, pageId, pageToken, userId) {
  const newMessages = [];

  // Fetch conversations for this Facebook Page
  const convRes = await axios.get(`${GRAPH_API}/${pageId}/conversations`, {
    params: {
      fields: 'id,participants,updated_time',
      access_token: pageToken,
      limit: 20,
    },
  });

  const fbConversations = convRes.data?.data || [];
  console.log(`[Facebook Sync] Found ${fbConversations.length} conversations for page ${pageId}`);

  for (const fbConv of fbConversations) {
    try {
      const msgs = await syncConversation(account, fbConv, pageId, pageToken, userId);
      newMessages.push(...msgs);
    } catch (err) {
      console.error('[Facebook Sync] Error syncing conversation:', fbConv.id, err.message);
    }
  }

  return newMessages;
}

async function syncConversation(account, fbConv, pageId, pageToken, userId) {
  const newMessages = [];

  // Fetch messages in this conversation
  const msgRes = await axios.get(`${GRAPH_API}/${fbConv.id}/messages`, {
    params: {
      fields: 'id,message,from,to,created_time,attachments',
      access_token: pageToken,
      limit: 25,
    },
  });

  const fbMessages = msgRes.data?.data || [];
  if (fbMessages.length === 0) return newMessages;

  // Determine the other participant (not our page)
  const participants = fbConv.participants?.data || [];
  const otherParticipant = participants.find((p) => p.id !== pageId) || participants[0];
  const contactPsid = otherParticipant?.id || 'unknown';
  const contactName = otherParticipant?.name || `FB User ${contactPsid.slice(-4)}`;

  // Upsert contact
  const contact = await prisma.contact.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'facebook',
        platformUserId: contactPsid,
      },
    },
    update: { name: contactName },
    create: {
      userId,
      platform: 'facebook',
      platformUserId: contactPsid,
      name: contactName,
    },
  });

  // Upsert conversation
  const conversation = await prisma.conversation.upsert({
    where: {
      connectedAccountId_platformConversationId: {
        connectedAccountId: account.id,
        platformConversationId: contactPsid,
      },
    },
    update: {},
    create: {
      connectedAccountId: account.id,
      platformConversationId: contactPsid,
      contactId: contact.id,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
  });

  // Process messages (oldest first)
  const sortedMessages = [...fbMessages].reverse();
  const connectedAt = new Date(account.createdAt);

  for (const fbMsg of sortedMessages) {
    // Skip messages before account connection
    const msgTime = fbMsg.created_time ? new Date(fbMsg.created_time) : null;
    if (msgTime && msgTime < connectedAt) continue;

    // Check if message already exists
    const existing = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        platformMessageId: fbMsg.id,
      },
    });
    if (existing) continue;

    const isFromPage = fbMsg.from?.id === pageId;
    const messageContent = fbMsg.message || '';

    // Extract attachments
    const syncAttachments = [];
    if (fbMsg.attachments?.data) {
      for (const att of fbMsg.attachments.data) {
        syncAttachments.push({
          filename: att.name || `fb_${att.type || 'file'}_${Date.now()}`,
          mimeType: att.mime_type || (att.type === 'image' ? 'image/jpeg' : att.type === 'video' ? 'video/mp4' : 'application/octet-stream'),
          size: att.size || 0,
          fileUrl: att.image_data?.url || att.video_data?.url || att.file_url || null,
          type: att.type || 'file',
        });
      }
    }

    // Determine content type
    let contentType = 'text';
    if (syncAttachments.length > 0) {
      const firstType = syncAttachments[0].type;
      if (firstType === 'image' || firstType === 'animated_image') contentType = 'image';
      else if (firstType === 'video') contentType = 'video';
      else if (firstType === 'audio') contentType = 'audio';
      else contentType = 'file';
    }

    if (!messageContent.trim() && syncAttachments.length === 0) continue;

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId: fbMsg.id,
        direction: isFromPage ? 'outbound' : 'inbound',
        sender: isFromPage ? (account.displayName || 'You') : contactName,
        content: messageContent || (syncAttachments.length > 0 ? `[${syncAttachments[0].type || 'Media'}]` : ''),
        contentType,
        attachments: syncAttachments.length > 0 ? syncAttachments : undefined,
        status: 'delivered',
        sentAt: new Date(fbMsg.created_time || Date.now()),
        rawPayload: fbMsg,
      },
    });

    message._isNew = true;
    newMessages.push(message);
  }

  // Bump conversation when new messages found
  if (newMessages.length > 0) {
    const newInbound = newMessages.filter((m) => m.direction === 'inbound');
    const updateData = { lastMessageAt: new Date() };
    if (newInbound.length > 0) {
      updateData.unreadCount = { increment: newInbound.length };
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: updateData,
    });
    console.log(`[Facebook Sync] ${newMessages.length} new messages in conversation with ${contactName}`);
  }

  return newMessages;
}
