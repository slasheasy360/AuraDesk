import { Router } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import * as whatsappService from '../services/whatsapp.js';

const router = Router();
const GRAPH_API = 'https://graph.facebook.com/v21.0';

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

// Connect WhatsApp via Embedded Signup — auto-discovers WABA and phone from the user access token
router.post('/connect-with-token', authenticate, async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('[WhatsApp Connect] Starting Embedded Signup connection for user:', req.user.id);

    let wabaId = null;
    let phoneNumberId = null;

    // Strategy 1: Use debug_token to discover WABA from granted scopes
    try {
      const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
      const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
        params: { input_token: accessToken, access_token: appToken },
      });
      const granularScopes = debugRes.data?.data?.granular_scopes || [];
      for (const scope of granularScopes) {
        if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
          wabaId = scope.target_ids[0];
          console.log('[WhatsApp Connect] Found WABA from token scopes:', wabaId);
          break;
        }
      }
    } catch (err) {
      console.warn('[WhatsApp Connect] debug_token failed:', err.response?.data?.error?.message || err.message);
    }

    // Strategy 2: Enumerate businesses -> owned_whatsapp_business_accounts
    if (!wabaId) {
      try {
        const businessRes = await axios.get(`${GRAPH_API}/me/businesses`, {
          params: { fields: 'id,name', access_token: accessToken },
        });

        for (const biz of businessRes.data?.data || []) {
          try {
            const wabaRes = await axios.get(`${GRAPH_API}/${biz.id}/owned_whatsapp_business_accounts`, {
              params: { fields: 'id,name', access_token: accessToken },
            });
            const wabas = wabaRes.data?.data || [];
            if (wabas.length > 0) {
              wabaId = wabas[0].id;
              break;
            }
          } catch { continue; }
        }
      } catch (err) {
        console.warn('[WhatsApp Connect] businesses discovery failed:', err.response?.data?.error?.message || err.message);
      }
    }

    // Discover phone number from WABA
    if (wabaId) {
      try {
        const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
          params: { fields: 'id,display_phone_number,verified_name', access_token: accessToken },
        });
        const phones = phoneRes.data?.data || [];
        if (phones.length > 0) {
          phoneNumberId = phones[0].id;
          console.log('[WhatsApp Connect] Found phone number:', phones[0].display_phone_number, '(ID:', phoneNumberId, ')');
        }
      } catch (err) {
        console.warn('[WhatsApp Connect] phone_numbers discovery failed:', err.response?.data?.error?.message || err.message);
      }
    }

    if (!wabaId || !phoneNumberId) {
      return res.status(400).json({
        error: 'Could not find a WhatsApp Business Account. Make sure you selected a WABA and phone number during signup.',
        discovered: { wabaId, phoneNumberId },
      });
    }

    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      accessToken
    );

    console.log('[WhatsApp Connect] ✓ WhatsApp account connected', {
      accountId: account.id,
      wabaId,
      phoneNumberId,
    });

    res.json({ account });
  } catch (err) {
    console.error('WhatsApp connect-with-token error:', err.response?.data || err.message);
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

// One-click connect using server env vars (WHATSAPP_WABA_ID, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_SYSTEM_USER_TOKEN)
router.post('/connect-env', authenticate, async (req, res) => {
  try {
    const wabaId = process.env.WHATSAPP_WABA_ID;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;

    if (!wabaId || !phoneNumberId || !accessToken) {
      return res.status(400).json({
        error: 'WhatsApp env vars not configured. Set WHATSAPP_WABA_ID, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_SYSTEM_USER_TOKEN on the server.',
      });
    }

    console.log('[WhatsApp Connect] One-click connect using env vars...');

    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      accessToken,
      'system_user'
    );

    console.log('[WhatsApp Connect] ✓ Connected via env vars', { accountId: account.id });
    res.json({ account });
  } catch (err) {
    console.error('WhatsApp connect-env error:', err.response?.data || err.message);
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

export default router;
