import { Router } from 'express';
import prisma from '../utils/prisma.js';
import * as gmailService from '../services/gmail.js';

const router = Router();

// Gmail push notification handler (from Pub/Sub)
// For POC, we use polling instead. This endpoint is here for future Pub/Sub integration.
router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const rawBody = req.body;
    const payload = JSON.parse(rawBody.toString());

    await prisma.webhookEventLog.create({
      data: {
        platform: 'gmail',
        payload,
        processed: false,
      },
    });
  } catch (err) {
    console.error('Gmail webhook error:', err);
  }
});

// Poll Gmail for new messages (called from frontend or cron)
router.get('/poll/:accountId', async (req, res) => {
  // Note: In production, this would be authenticated. For simplicity in POC,
  // the frontend calls this with the account ID.
  try {
    const { accountId } = req.params;

    const account = await prisma.connectedAccount.findUnique({
      where: { id: accountId },
      include: { user: true },
    });

    if (!account || account.platform !== 'gmail') {
      return res.status(404).json({ error: 'Gmail account not found' });
    }

    const messages = await gmailService.fetchMessages(accountId, 20);
    const io = req.app.get('io');

    for (const gmailMsg of messages) {
      const headers = gmailService.parseEmailHeaders(gmailMsg.payload?.headers || []);
      const from = headers.from || 'Unknown';
      const subject = headers.subject || '(No Subject)';
      const threadId = gmailMsg.threadId;

      // Extract email address from "Name <email>" format
      const emailMatch = from.match(/<(.+?)>/) || [null, from];
      const fromEmail = emailMatch[1] || from;
      const fromName = from.replace(/<.+?>/, '').trim() || fromEmail;

      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: {
          userId_platform_platformUserId: {
            userId: account.userId,
            platform: 'gmail',
            platformUserId: fromEmail,
          },
        },
        update: { name: fromName },
        create: {
          userId: account.userId,
          platform: 'gmail',
          platformUserId: fromEmail,
          name: fromName,
        },
      });

      // Upsert conversation (by thread ID)
      const conversation = await prisma.conversation.upsert({
        where: {
          connectedAccountId_platformConversationId: {
            connectedAccountId: account.id,
            platformConversationId: threadId,
          },
        },
        update: {
          lastMessageAt: new Date(parseInt(gmailMsg.internalDate)),
        },
        create: {
          connectedAccountId: account.id,
          platformConversationId: threadId,
          contactId: contact.id,
          lastMessageAt: new Date(parseInt(gmailMsg.internalDate)),
          unreadCount: gmailMsg.labelIds?.includes('UNREAD') ? 1 : 0,
        },
      });

      // Check if message already exists
      const existing = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          platformMessageId: gmailMsg.id,
        },
      });

      if (!existing) {
        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            platformMessageId: gmailMsg.id,
            direction: 'inbound',
            content: subject,
            contentType: 'email',
            status: 'delivered',
            sentAt: new Date(parseInt(gmailMsg.internalDate)),
            rawPayload: gmailMsg,
          },
        });

        io.to(`user:${account.userId}`).emit('new_message', {
          message,
          conversationId: conversation.id,
          platform: 'gmail',
        });
      }
    }

    res.json({ synced: messages.length });
  } catch (err) {
    console.error('Gmail poll error:', err);
    res.status(500).json({ error: 'Failed to poll Gmail' });
  }
});

export default router;
