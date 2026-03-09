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

// Connect WhatsApp with just an access token — uses env vars or auto-discovery for WABA/phone
router.post('/connect-with-token', authenticate, async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('[WhatsApp Connect] Starting connection...');

    let wabaId = process.env.WHATSAPP_WABA_ID || null;
    let phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;

    // If env vars are set, verify the token works with them
    if (wabaId && phoneNumberId) {
      console.log('[WhatsApp Connect] Using env vars — WABA:', wabaId, 'Phone:', phoneNumberId);

      // Verify token has access to this phone number
      try {
        const verifyRes = await axios.get(`${GRAPH_API}/${phoneNumberId}`, {
          params: {
            fields: 'display_phone_number,verified_name',
            access_token: accessToken,
          },
        });
        console.log('[WhatsApp Connect] Token verified for phone:', verifyRes.data.display_phone_number);
      } catch (verifyErr) {
        console.warn('[WhatsApp Connect] Token verification warning:', verifyErr.response?.data?.error?.message || verifyErr.message);
        // Continue anyway — the token might still work for messaging
      }
    } else {
      // Auto-discover WABA and phone number from the token
      console.log('[WhatsApp Connect] No env vars, attempting auto-discovery...');

      // Try /me/businesses -> owned_whatsapp_business_accounts
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
              const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
                params: { fields: 'id,display_phone_number,verified_name', access_token: accessToken },
              });
              const phones = phoneRes.data?.data || [];
              if (phones.length > 0) phoneNumberId = phones[0].id;
              break;
            }
          } catch { continue; }
        }
      } catch {
        // try next method
      }

      // Try direct WABA endpoint
      if (!wabaId) {
        try {
          const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
            params: { input_token: accessToken, access_token: accessToken },
          });
          const granularScopes = debugRes.data?.data?.granular_scopes || [];
          for (const scope of granularScopes) {
            if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
              wabaId = scope.target_ids[0];
              console.log('[WhatsApp Connect] Found WABA from token scopes:', wabaId);
              const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
                params: { fields: 'id,display_phone_number,verified_name', access_token: accessToken },
              });
              const phones = phoneRes.data?.data || [];
              if (phones.length > 0) phoneNumberId = phones[0].id;
              break;
            }
          }
        } catch {
          // continue
        }
      }
    }

    if (!wabaId || !phoneNumberId) {
      return res.status(400).json({
        error: 'Could not determine WhatsApp Business Account details. Please set WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID environment variables on the server.',
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

export default router;
