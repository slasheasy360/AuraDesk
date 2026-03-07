import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as whatsappService from '../services/whatsapp.js';

const router = Router();

// Handle WhatsApp Embedded Signup result from frontend
router.post('/connect', authenticate, async (req, res) => {
  try {
    const { wabaId, phoneNumberId, accessToken } = req.body;
    if (!wabaId || !phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'Missing required fields: wabaId, phoneNumberId, accessToken' });
    }

    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      accessToken
    );

    res.json({ account });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
