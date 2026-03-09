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

// Auto-discover WABA details from an access token and connect
router.post('/connect-with-token', authenticate, async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('[WhatsApp Connect] Discovering WABA details from token...');

    let wabaId = null;
    let phoneNumberId = null;

    // Step 1: Find all WhatsApp Business Accounts accessible with this token
    try {
      const businessRes = await axios.get(`${GRAPH_API}/me/businesses`, {
        params: {
          fields: 'id,name',
          access_token: accessToken,
        },
      });

      const businesses = businessRes.data?.data || [];
      console.log('[WhatsApp Connect] Businesses found:', businesses.length);

      // Step 2: For each business, find WABA
      for (const biz of businesses) {
        try {
          const wabaRes = await axios.get(`${GRAPH_API}/${biz.id}/owned_whatsapp_business_accounts`, {
            params: {
              fields: 'id,name',
              access_token: accessToken,
            },
          });

          const wabas = wabaRes.data?.data || [];
          if (wabas.length > 0) {
            wabaId = wabas[0].id;
            console.log('[WhatsApp Connect] Found WABA:', wabaId, wabas[0].name);

            // Step 3: Get phone numbers for this WABA
            const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
              params: {
                fields: 'id,display_phone_number,verified_name,quality_rating',
                access_token: accessToken,
              },
            });

            const phones = phoneRes.data?.data || [];
            if (phones.length > 0) {
              phoneNumberId = phones[0].id;
              console.log('[WhatsApp Connect] Found phone:', phoneNumberId, phones[0].display_phone_number);
            }
            break;
          }
        } catch {
          continue;
        }
      }
    } catch (err) {
      console.log('[WhatsApp Connect] Business discovery error:', err.response?.data?.error?.message || err.message);
    }

    // If business discovery didn't work, try shared WABAs
    if (!wabaId) {
      console.log('[WhatsApp Connect] Trying shared WABAs...');
      try {
        const sharedRes = await axios.get(`${GRAPH_API}/me/whatsapp_business_accounts`, {
          params: {
            fields: 'id,name',
            access_token: accessToken,
          },
        });
        const sharedWabas = sharedRes.data?.data || [];
        if (sharedWabas.length > 0) {
          wabaId = sharedWabas[0].id;
          console.log('[WhatsApp Connect] Found shared WABA:', wabaId);

          const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
            params: {
              fields: 'id,display_phone_number,verified_name',
              access_token: accessToken,
            },
          });
          const phones = phoneRes.data?.data || [];
          if (phones.length > 0) {
            phoneNumberId = phones[0].id;
          }
        }
      } catch {
        // continue to env fallback
      }
    }

    // Fallback: use env vars if auto-discovery didn't work
    if (!wabaId && process.env.WHATSAPP_WABA_ID) {
      wabaId = process.env.WHATSAPP_WABA_ID;
      console.log('[WhatsApp Connect] Using WABA ID from env:', wabaId);
    }
    if (!phoneNumberId && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      console.log('[WhatsApp Connect] Using Phone Number ID from env:', phoneNumberId);
    }

    if (!wabaId || !phoneNumberId) {
      return res.status(400).json({
        error: 'Could not auto-discover WhatsApp Business Account. Please provide wabaId and phoneNumberId manually.',
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
