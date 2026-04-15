import { Router } from 'express';
import axios from 'axios';
import { authenticate, getWorkspaceOwnerId, requireAdmin } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const router = Router();

// Get all connected accounts for the workspace
// All team members can view — returns the owner's connected platforms
router.get('/', authenticate, async (req, res) => {
  try {
    const ownerId = getWorkspaceOwnerId(req.user);
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: ownerId },
      select: {
        id: true,
        platform: true,
        platformAccountId: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ accounts });
  } catch (err) {
    console.error('Get accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Disconnect an account — admin/owner only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const ownerId = getWorkspaceOwnerId(req.user);
    const account = await prisma.connectedAccount.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // For WhatsApp: also deregister the phone from Meta's WABA so reconnection works cleanly.
    // Without this, the phone stays registered on Meta's side and the next Embedded Signup
    // shows "This phone number is already registered to a WhatsApp account."
    if (account.platform === 'whatsapp') {
      const waAccount = await prisma.whatsappAccount.findFirst({
        where: { connectedAccountId: account.id },
        include: { connectedAccount: { include: { authToken: true } } },
      });

      if (waAccount?.phoneNumberId) {
        const systemToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
        let userToken = null;
        try {
          if (waAccount.connectedAccount?.authToken?.accessTokenEncrypted) {
            userToken = decrypt(waAccount.connectedAccount.authToken.accessTokenEncrypted);
          }
        } catch { /* ignore decryption errors */ }

        const accessToken = systemToken || userToken;
        if (accessToken) {
          try {
            await axios.delete(`https://graph.facebook.com/v21.0/${waAccount.phoneNumberId}`, {
              params: { access_token: accessToken },
            });
            console.log('[WhatsApp Disconnect] Deregistered phone from Meta WABA:', waAccount.phoneNumberId);
          } catch (err) {
            // Non-fatal — DB cleanup still proceeds; phone may need manual removal in Meta dashboard
            console.warn('[WhatsApp Disconnect] Could not deregister from Meta (non-fatal):', err.response?.data?.error?.message || err.message);
          }
        }
      }
    }

    // Remove WhatsApp-specific records and auth token so the phone number is freed for reconnection
    await prisma.authToken.deleteMany({ where: { connectedAccountId: account.id } });
    await prisma.whatsappAccount.deleteMany({ where: { connectedAccountId: account.id } });
    await prisma.webhookSubscription.deleteMany({ where: { connectedAccountId: account.id } });

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { status: 'disconnected' },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

export default router;
