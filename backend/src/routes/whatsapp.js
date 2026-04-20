import { Router } from 'express';
import axios from 'axios';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as whatsappService from '../services/whatsapp.js';
import { assertCanConnectPlatform } from '../services/planGuard.js';
import prisma from '../utils/prisma.js';

const router = Router();
const GRAPH_API = 'https://graph.facebook.com/v21.0';

// Handle WhatsApp Embedded Signup result from frontend — admin/owner only
router.post('/connect', authenticate, requireAdmin, async (req, res) => {
  try {
    // Phase 1: log-only plan guard (never blocks).
    try { await assertCanConnectPlatform(req.user, 'whatsapp', { context: 'whatsapp/connect' }); } catch (_) {}
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
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Exchange authorization code from Embedded Signup for access token, then connect — admin/owner only
router.post('/exchange', authenticate, requireAdmin, async (req, res) => {
  try {
    // Phase 1: log-only plan guard (never blocks).
    try { await assertCanConnectPlatform(req.user, 'whatsapp', { context: 'whatsapp/exchange' }); } catch (_) {}
    const { code, waba_id, phone_number_id } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'No authorization code received' });
    }

    console.log('[WhatsApp Exchange] Starting code exchange for user:', req.user.id, { waba_id, phone_number_id });

    // Step 1: Exchange code for access token (server-to-server)
    // For FB JS SDK popup flow, redirect_uri must be empty string per Meta docs
    const redirectUri = process.env.WHATSAPP_REDIRECT_URI || '';
    console.log('[WhatsApp Exchange] Using redirect_uri:', JSON.stringify(redirectUri));
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
    // IMPORTANT: for WhatsApp Business Account, the only valid field is 'messages'.
    // 'message_status' and 'messaging_postbacks' are Facebook Page fields and will
    // cause the subscription to fail or be ignored for WABA.
    const tokenToUse = process.env.WHATSAPP_SYSTEM_USER_TOKEN || accessToken;
    console.log('[WhatsApp Exchange] Subscribing webhook — WABA:', wabaId, 'using', process.env.WHATSAPP_SYSTEM_USER_TOKEN ? 'system token' : 'user token');
    try {
      const subRes = await axios.post(`${GRAPH_API}/${wabaId}/subscribed_apps`, null, {
        params: {
          access_token: tokenToUse,
          subscribed_fields: 'messages',
        },
      });
      console.log('[WhatsApp Exchange] ✓ Webhook subscription OK for WABA:', wabaId, subRes.data);
    } catch (err) {
      console.error('[WhatsApp Exchange] ✗ Webhook subscription failed:', err.response?.data || err.message);
    }

    // Step 4: Save the connection
    console.log('[WhatsApp Exchange] Saving connection — userId:', req.user.id, 'wabaId:', wabaId, 'phoneNumberId:', phoneNumberId);
    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      accessToken
    );

    console.log('[WhatsApp Exchange] ✓ WhatsApp account connected', {
      accountId: account.id,
      platform: account.platform,
      status: account.status,
      wabaId,
      phoneNumberId,
    });

    res.json({ success: true, account, waba_id: wabaId, phone_number_id: phoneNumberId });
  } catch (err) {
    console.error('WhatsApp exchange error:', err.response?.data || err.message);
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

// Connect WhatsApp via Embedded Signup — auto-discovers WABA and phone from the user access token — admin/owner only
router.post('/connect-with-token', authenticate, requireAdmin, async (req, res) => {
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
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

// One-click connect using server env vars — admin/owner only
router.post('/connect-env', authenticate, requireAdmin, async (req, res) => {
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
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Failed to connect WhatsApp: ${detail}` });
  }
});

// POST /auth/whatsapp/finalize-signup
// Called by the frontend after the user completes the Meta-hosted Embedded Signup URL popup — admin/owner only.
router.post('/finalize-signup', authenticate, requireAdmin, async (req, res) => {
  try {
    const { waba_id, phone_number_id } = req.body || {};
    console.log('[WhatsApp Finalize] Request — userId:', req.user.id, 'waba_id:', waba_id, 'phone_number_id:', phone_number_id);

    if (!waba_id) {
      return res.status(400).json({ error: 'waba_id is required' });
    }

    const systemToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    if (!systemToken) {
      return res.status(400).json({
        error: 'WHATSAPP_SYSTEM_USER_TOKEN not configured on server. Cannot finalize Meta-hosted signup without it.',
        code: 'SYSTEM_TOKEN_MISSING',
      });
    }

    // Discover phone number from WABA if not provided
    let phoneId = phone_number_id || null;
    if (!phoneId) {
      try {
        const phoneRes = await axios.get(`${GRAPH_API}/${waba_id}/phone_numbers`, {
          params: { fields: 'id,display_phone_number,verified_name', access_token: systemToken },
        });
        const phones = phoneRes.data?.data || [];
        if (phones.length > 0) {
          phoneId = phones[0].id;
          console.log('[WhatsApp Finalize] Discovered phone:', phones[0].display_phone_number, 'id:', phoneId);
        }
      } catch (err) {
        console.warn('[WhatsApp Finalize] phone discovery failed:', err.response?.data?.error?.message || err.message);
      }
    }

    if (!phoneId) {
      return res.status(400).json({ error: 'No phone number found in WABA. Complete signup with a phone number and try again.' });
    }

    // Subscribe webhook
    console.log('[WhatsApp Finalize] Subscribing webhook for WABA:', waba_id);
    try {
      await axios.post(`${GRAPH_API}/${waba_id}/subscribed_apps`, null, {
        params: { access_token: systemToken, subscribed_fields: 'messages' },
      });
      console.log('[WhatsApp Finalize] ✓ Webhook subscription OK');
    } catch (err) {
      console.error('[WhatsApp Finalize] ✗ Webhook subscription failed:', err.response?.data || err.message);
    }

    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id, waba_id, phoneId, systemToken, 'system_user'
    );

    console.log('[WhatsApp Finalize] ✓ Connection saved, accountId:', account.id);
    res.json({ success: true, account });
  } catch (err) {
    console.error('[WhatsApp Finalize] ✗ Error:', err.response?.data || err.message);
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// POST /api/whatsapp/reconnect-direct
// Reconnects WhatsApp directly using stored WABA + system token — admin/owner only
router.post('/reconnect-direct', authenticate, requireAdmin, async (req, res) => {
  try {
    const systemToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    if (!systemToken) {
      return res.json({ available: false, reason: 'WHATSAPP_SYSTEM_USER_TOKEN not configured' });
    }

    // Find any previous WhatsApp connectedAccount (active OR disconnected) to recover WABA ID
    const prevAccount = await prisma.connectedAccount.findFirst({
      where: { userId: req.user.id, platform: 'whatsapp' },
      orderBy: { createdAt: 'desc' },
    });

    if (!prevAccount) {
      return res.json({ available: false, reason: 'No previous WhatsApp connection found' });
    }

    const wabaId = prevAccount.platformAccountId;
    console.log('[WhatsApp Reconnect] Attempting direct reconnect with WABA:', wabaId);

    // List phone numbers in the WABA using system user token
    let phoneNumberId = null;
    let phoneDisplay = null;
    try {
      const phoneRes = await axios.get(`${GRAPH_API}/${wabaId}/phone_numbers`, {
        params: { fields: 'id,display_phone_number,verified_name', access_token: systemToken },
      });
      const phones = phoneRes.data?.data || [];
      if (phones.length > 0) {
        phoneNumberId = phones[0].id;
        phoneDisplay = phones[0].display_phone_number;
        console.log('[WhatsApp Reconnect] Found phone:', phoneDisplay, 'id:', phoneNumberId);
      }
    } catch (err) {
      console.warn('[WhatsApp Reconnect] Could not list WABA phones:', err.response?.data?.error?.message || err.message);
      return res.json({ available: false, reason: 'Could not retrieve phone numbers from WABA' });
    }

    if (!phoneNumberId) {
      return res.json({ available: false, reason: 'No phone numbers registered in WABA' });
    }

    // Reconnect directly — bypasses Embedded Signup entirely, avoids "already registered" error
    const account = await whatsappService.handleEmbeddedSignup(
      req.user.id,
      wabaId,
      phoneNumberId,
      systemToken,
      'system_user'
    );

    console.log('[WhatsApp Reconnect] Direct reconnect successful, accountId:', account.id);
    return res.json({ available: true, account });
  } catch (err) {
    console.error('[WhatsApp Reconnect] Error:', err.response?.data || err.message);
    if (err.code === 'DUPLICATE_PHONE') {
      return res.status(409).json({ error: err.message });
    }
    return res.json({ available: false, reason: err.message });
  }
});

// Re-subscribe webhook for an existing WhatsApp account (fixes missing messages after initial connect)
router.post('/resubscribe', authenticate, async (req, res) => {
  try {
    const GRAPH = 'https://graph.facebook.com/v21.0';
    const systemToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    if (!systemToken) {
      return res.status(400).json({ error: 'WHATSAPP_SYSTEM_USER_TOKEN not configured on server' });
    }

    const waAccount = await prisma.whatsappAccount.findFirst({
      where: { connectedAccount: { userId: req.user.id, status: 'active' } },
    });

    if (!waAccount) {
      return res.status(404).json({ error: 'No active WhatsApp account found' });
    }

    await axios.post(`${GRAPH}/${waAccount.wabaId}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${systemToken}` },
      params: { subscribed_fields: 'messages' },
    });

    console.log('[WhatsApp] Re-subscription successful for WABA:', waAccount.wabaId);
    res.json({ success: true, wabaId: waAccount.wabaId });
  } catch (err) {
    console.error('WhatsApp resubscribe error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// GET /auth/whatsapp/status — diagnostic: webhook subscription + recent events
router.get('/status', authenticate, async (req, res) => {
  try {
    const waAccount = await prisma.whatsappAccount.findFirst({
      where: { connectedAccount: { userId: req.user.id, status: 'active' } },
      include: { connectedAccount: true },
    });

    if (!waAccount) {
      return res.json({ connected: false });
    }

    // Recent webhook events — return ALL recent WA events so the user can see
    // what Meta is actually sending, including events that didn't match this WABA.
    const recentEvents = await prisma.webhookEventLog.findMany({
      where: { platform: 'whatsapp' },
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: { id: true, receivedAt: true, payload: true },
    });

    const wabaEvents = recentEvents.filter((e) => {
      try {
        const p = e.payload;
        return (p?.entry || []).some((en) => en.id === waAccount.wabaId);
      } catch { return false; }
    });

    // Summarize each event for easy inspection in the UI.
    // Iterate ALL entries and ALL changes — one webhook event can carry many.
    const eventsSummary = recentEvents.flatMap((e) => {
      const entries = e.payload?.entry || [];
      const rows = [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          const val = change.value || {};
          // smb_message_echoes uses value.message_echoes, not value.messages
          const messages = val.messages || val.message_echoes || [];
          const statuses = val.statuses || [];
          if (messages.length === 0 && statuses.length === 0) {
            rows.push({
              id: e.id,
              receivedAt: e.receivedAt,
              wabaId: entry.id,
              field: change.field,
              phoneNumberId: val.metadata?.phone_number_id,
              messageSummary: null,
              hasStatuses: false,
              rawPayload: e.payload,
            });
            continue;
          }
          for (const msg of messages) {
            rows.push({
              id: e.id,
              receivedAt: e.receivedAt,
              wabaId: entry.id,
              field: change.field,
              phoneNumberId: val.metadata?.phone_number_id,
              messageSummary: {
                id: msg.id,
                type: msg.type,
                from: msg.from,
                to: msg.to,
                recipient_id: msg.recipient_id,
                text: msg.text?.body?.substring(0, 80),
              },
              hasStatuses: false,
              rawPayload: e.payload,
            });
          }
          for (const st of statuses) {
            rows.push({
              id: e.id,
              receivedAt: e.receivedAt,
              wabaId: entry.id,
              field: change.field,
              phoneNumberId: val.metadata?.phone_number_id,
              messageSummary: null,
              statusSummary: { id: st.id, status: st.status, recipient_id: st.recipient_id },
              hasStatuses: true,
              rawPayload: e.payload,
            });
          }
        }
      }
      return rows;
    });

    // Check WABA subscription status via Meta API
    let subscriptionStatus = null;
    const systemToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    if (systemToken) {
      try {
        const subRes = await axios.get(`${GRAPH_API}/${waAccount.wabaId}/subscribed_apps`, {
          params: { access_token: systemToken },
        });
        subscriptionStatus = subRes.data;
      } catch (err) {
        subscriptionStatus = { error: err.response?.data?.error?.message || err.message };
      }
    }

    res.json({
      connected: true,
      account: {
        phoneNumberId: waAccount.phoneNumberId,
        wabaId: waAccount.wabaId,
        phoneNumber: waAccount.phoneNumber,
        businessName: waAccount.businessName,
        connectedAt: waAccount.connectedAccount.createdAt,
      },
      webhookUrl: `${process.env.APP_URL}/webhooks/meta`,
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
      recentEventsCount: wabaEvents.length,
      totalRecentEventsCount: recentEvents.length,
      lastEventAt: wabaEvents[0]?.receivedAt || null,
      subscriptionStatus,
      eventsSummary,
    });
  } catch (err) {
    console.error('WhatsApp status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
