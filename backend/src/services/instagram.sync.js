import axios from 'axios';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Sync Instagram DM conversations for a user by polling the Instagram Conversations API.
 * Similar pattern to Gmail sync — fetches conversations and messages via API.
 */
export async function syncInstagramMessages(userId) {
  // Find all active Instagram connected accounts for this user
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, platform: 'instagram', status: 'active' },
    include: { authToken: true },
  });

  if (accounts.length === 0) return [];

  const allNewMessages = [];

  for (const account of accounts) {
    if (!account.authToken) {
      console.warn('[Instagram Sync] No auth token for account:', account.id);
      continue;
    }

    const pageToken = decrypt(account.authToken.accessTokenEncrypted);
    const igUserId = account.platformAccountId;

    try {
      const messages = await syncAccountMessages(account, igUserId, pageToken, userId);
      allNewMessages.push(...messages);
    } catch (err) {
      const errCode = err.response?.data?.error?.code;
      const errMsg = err.response?.data?.error?.message || err.message;
      // Code 3 = "Application does not have the capability" — means instagram_manage_messages
      // permission not approved. Log once quietly, don't spam.
      if (errCode === 3) {
        // Only log first time, not every 60s poll
        if (!syncInstagramMessages._capabilityWarned) {
          console.warn('[Instagram Sync] Conversations API not available (app needs instagram_manage_messages Advanced Access). Sync disabled until permission is granted.');
          syncInstagramMessages._capabilityWarned = true;
        }
      } else {
        console.error('[Instagram Sync] Error syncing account:', account.id, errMsg);
      }
    }
  }

  return allNewMessages;
}

async function syncAccountMessages(account, igUserId, pageToken, userId) {
  const newMessages = [];

  // Fetch conversations for this Instagram Business Account
  const convRes = await axios.get(`${GRAPH_API}/${igUserId}/conversations`, {
    params: {
      fields: 'id,participants{id,username,name},updated_time',
      access_token: pageToken,
      limit: 20,
    },
  });

  const igConversations = convRes.data?.data || [];
  console.log(`[Instagram Sync] Found ${igConversations.length} conversations for IG account ${igUserId}`);

  for (const igConv of igConversations) {
    try {
      const msgs = await syncConversation(account, igConv, igUserId, pageToken, userId);
      newMessages.push(...msgs);
    } catch (err) {
      console.error('[Instagram Sync] Error syncing conversation:', igConv.id, err.message);
    }
  }

  return newMessages;
}

async function syncConversation(account, igConv, igUserId, pageToken, userId) {
  const newMessages = [];

  // Fetch messages in this conversation
  const msgRes = await axios.get(`${GRAPH_API}/${igConv.id}`, {
    params: {
      fields: 'messages{id,message,from,to,created_time}',
      access_token: pageToken,
    },
  });

  const igMessages = msgRes.data?.messages?.data || [];
  if (igMessages.length === 0) return newMessages;

  // Determine the other participant (not our IG account)
  const participants = igConv.participants?.data || [];
  const otherParticipant = participants.find((p) => p.id !== igUserId) || participants[0];
  const senderId = otherParticipant?.id || 'unknown';
  const senderName = otherParticipant?.username || otherParticipant?.name || `IG User ${senderId.slice(-4)}`;

  // Upsert contact
  const contact = await prisma.contact.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'instagram',
        platformUserId: senderId,
      },
    },
    update: { name: senderName },
    create: {
      userId,
      platform: 'instagram',
      platformUserId: senderId,
      name: senderName,
    },
  });

  // Upsert conversation (use the IG conversation ID as platform conversation ID)
  const conversation = await prisma.conversation.upsert({
    where: {
      connectedAccountId_platformConversationId: {
        connectedAccountId: account.id,
        platformConversationId: igConv.id,
      },
    },
    update: {
      lastMessageAt: new Date(igConv.updated_time || Date.now()),
    },
    create: {
      connectedAccountId: account.id,
      platformConversationId: igConv.id,
      contactId: contact.id,
      lastMessageAt: new Date(igConv.updated_time || Date.now()),
      unreadCount: 0,
    },
  });

  // Process messages (oldest first)
  const sortedMessages = igMessages.reverse();

  for (const igMsg of sortedMessages) {
    // Check if message already exists
    const existing = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        platformMessageId: igMsg.id,
      },
    });

    if (existing) continue;

    const isFromUs = igMsg.from?.id === igUserId;
    const messageContent = igMsg.message || '';

    // Skip empty messages
    if (!messageContent.trim()) continue;

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId: igMsg.id,
        direction: isFromUs ? 'outbound' : 'inbound',
        sender: isFromUs ? (account.displayName || 'You') : senderName,
        content: messageContent,
        contentType: 'text',
        status: 'delivered',
        sentAt: new Date(igMsg.created_time || Date.now()),
        rawPayload: igMsg,
      },
    });

    message._isNew = true;
    newMessages.push(message);
  }

  // Update unread count for new inbound messages
  const newInbound = newMessages.filter((m) => m.direction === 'inbound');
  if (newInbound.length > 0) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: newInbound.length },
      },
    });
  }

  if (newMessages.length > 0) {
    console.log(`[Instagram Sync] ${newMessages.length} new messages in conversation ${igConv.id}`);
  }

  return newMessages;
}
