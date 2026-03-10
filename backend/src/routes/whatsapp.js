import { Router } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import * as whatsappService from '../services/whatsapp.js';

const router = Router();
const GRAPH_API = 'https://graph.facebook.com/v20.0';

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

// Exchange authorization code from Embedded Signup for access token, then connect
router.post('/exchange', authenticate, async (req, res) => {
  try {
    const { code, waba_id, phone_number_id } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'No authorization code received' });
    }

    console.log('[WhatsApp Exchange] Starting code exchange for user:', req.user.id, { waba_id, phone_number_id });

    // Step 1: Exchange code for access token (server-to-server)
    const redirectUri = process.env.WHATSAPP_REDIRECT_URI || process.env.FRONTEND_URL || 'http://localhost:5173';
    const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        client_id: process.env.META_APP_ID,
        redirect_uri: redirectUri,
        client_secret: process.env.META_APP_SECRET,
        code,
      },
    });

    if (!tokenRes.data?.access_token) {
      console.error('[WhatsApp Exchange] Token exchange failed:', tokenRes.data);
      return res.status(400).json({ error: 'Token exchange failed', details: tokenRes.data });
    }

    const accessToken = tokenRes.data.access_token;
    console.log('[WhatsApp Exchange] Token exchanged successfully');

    // Step 2: Determine WABA ID and phone number ID
    let wabaId = waba_id || null;
    let phoneNumberId = phone_number_id || null;

    // If WABA ID not provided via postMessage, discover from token scopes
    if (!wabaId) {
      try {
        const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
        const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
          params: { input_token: accessToken, access_token: appToken },
        });
        const granularScopes = debugRes.data?.data?.granular_scopes || [];
        for (const scope of granularScopes) {
          if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
            wabaId = scope.target_ids[0];
            console.log('[WhatsApp Exchange] Found WABA from token scopes:', wabaId);
            break;
          }
        }
      } catch (err) {
        console.warn('[WhatsApp Exchange] debug_token failed:', err.response?.data?.error?.message || err.message);
      }
    }

    // If phone number ID not provided, discover from WABA
    if (wabaId && !phoneNumberId) {
      try {
        const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
          params: { fields: 'id,display_phone_number,verified_name', access_token: accessToken },
        });
        const phones = phoneRes.data?.data || [];
        if (phones.length > 0) {
          phoneNumberId = phones[0].id;
          console.log('[WhatsApp Exchange] Found phone number:', phones[0].display_phone_number, '(ID:', phoneNumberId, ')');
        }
      } catch (err) {
        console.warn('[WhatsApp Exchange] phone_numbers discovery failed:', err.response?.data?.error?.message || err.message);
      }
    }

    if (!wabaId || !phoneNumberId) {
      return res.status(400).json({
        error: 'Could not find a WhatsApp Business Account. Make sure you selected a WABA and phone number during signup.',
        discovered: { wabaId, phoneNumberId },
      });
    }

    // Step 3: Subscribe WABA to webhooks
    const tokenToUse = process.env.WHATSAPP_SYSTEM_USER_TOKEN || accessToken;
    try {
      await axios.post(`${GRAPH_API}/${wabaId}/subscribed_apps`, null, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
        params: {
          subscribed_fields: 'messages,message_status,messaging_postbacks',
        },
      });
      console.log('[WhatsApp Exchange] Webhook subscription successful for WABA:', wabaId);
    } catch (err) {
      console.warn('[WhatsApp Exchange] Webhook subscription failed (non-fatal):', err.response?.data?.error?.message || err.message);
    }

    // Step 4: Save the connection
    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      accessToken
    );

    console.log('[WhatsApp Exchange] WhatsApp account connected', {
      accountId: account.id,
      wabaId,
      phoneNumberId,
    });

    res.json({ success: true, account, waba_id: wabaId, phone_number_id: phoneNumberId });
  } catch (err) {
    console.error('WhatsApp exchange error:', err.response?.data || err.message);
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

// Connect WhatsApp via Embedded Signup — auto-discovers WABA and phone from the user access token
router.post('/connect-with-token', authenticate, async (req, res) => {
  try {
    const { accessToken, wabaId: frontendWabaId, phoneNumberId: frontendPhoneNumberId } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('[WhatsApp Connect] Starting Embedded Signup connection for user:', req.user.id);

    // Use IDs from Embedded Signup sessionInfoListener if provided
    let wabaId = frontendWabaId || null;
    let phoneNumberId = frontendPhoneNumberId || null;

    if (wabaId && phoneNumberId) {
      console.log('[WhatsApp Connect] Using WABA/phone from Embedded Signup session:', { wabaId, phoneNumberId });
    }

    // Strategy 1: Use debug_token to discover WABA from granted scopes
    if (!wabaId) try {
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
    if (wabaId && !phoneNumberId) {
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

    console.log('[WhatsApp Connect] WhatsApp account connected', {
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

    console.log('[WhatsApp Connect] Connected via env vars', { accountId: account.id });
    res.json({ account });
  } catch (err) {
    console.error('WhatsApp connect-env error:', err.response?.data || err.message);
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

export default router;
