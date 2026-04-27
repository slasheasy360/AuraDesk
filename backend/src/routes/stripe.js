import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { getStripe } from '../utils/stripe.js';

const router = Router();

// Returns the workspace owner's id — team members share the owner's Stripe account.
function resolveOwnerId(user) {
  return user.inviterUserId || user.id;
}

// HMAC-signed state token for OAuth CSRF protection.
function signState(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifyState(state) {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(payload)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

// ── GET /api/stripe/status ────────────────────────────────────────────────
// Returns whether the workspace has a connected Stripe account.
router.get('/status', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: {
        stripeConnectAccountId: true,
        stripeConnectAccountName: true,
        stripeConnectChargesEnabled: true,
      },
    });

    const connectConfigured = !!process.env.STRIPE_CONNECT_CLIENT_ID;

    if (!owner?.stripeConnectAccountId) {
      return res.json({ connected: false, account_name: null, connect_configured: connectConfigured });
    }

    const stripe = getStripe();
    if (!stripe) {
      // SDK not available — return cached data
      return res.json({
        connected: true,
        account_name: owner.stripeConnectAccountName,
        charges_enabled: owner.stripeConnectChargesEnabled,
        connect_configured: connectConfigured,
      });
    }

    // Verify the account is still accessible on Stripe
    try {
      const account = await stripe.accounts.retrieve(owner.stripeConnectAccountId);
      const accountName =
        account.business_profile?.name ||
        account.display_name ||
        account.email ||
        owner.stripeConnectAccountName ||
        null;

      // Sync cached fields if they drifted
      if (
        accountName !== owner.stripeConnectAccountName ||
        account.charges_enabled !== owner.stripeConnectChargesEnabled
      ) {
        await prisma.user.update({
          where: { id: ownerId },
          data: {
            stripeConnectAccountName: accountName,
            stripeConnectChargesEnabled: account.charges_enabled,
          },
        });
      }

      return res.json({
        connected: true,
        account_name: accountName,
        charges_enabled: account.charges_enabled,
        connect_configured: connectConfigured,
      });
    } catch (stripeErr) {
      // Account deleted or deauthorised on Stripe side — clear locally
      if (
        stripeErr.type === 'StripeInvalidRequestError' ||
        stripeErr.code === 'account_invalid'
      ) {
        console.warn(`[Stripe] Connected account no longer accessible for user ${ownerId}, clearing`);
        await prisma.user.update({
          where: { id: ownerId },
          data: {
            stripeConnectAccountId: null,
            stripeConnectAccountName: null,
            stripeConnectChargesEnabled: false,
          },
        });
        return res.json({ connected: false, account_name: null, connect_configured: connectConfigured });
      }
      throw stripeErr;
    }
  } catch (err) {
    console.error('[Stripe] Status check failed:', err.message);
    res.status(500).json({ error: 'Failed to check Stripe status' });
  }
});

// ── GET /api/stripe/connect — initiate Stripe Connect OAuth ──────────────
// Returns the OAuth authorise URL; the frontend is responsible for redirecting.
router.get('/connect', authenticate, requireActiveSubscription, async (req, res) => {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Stripe Connect is not configured on this platform' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured on this platform' });
  }

  const ownerId = resolveOwnerId(req.user);
  const backendUrl =
    process.env.BACKEND_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:3001';

  const state = signState({ userId: ownerId });
  const redirectUri = `${backendUrl}/api/stripe/connect/callback`;

  const url = stripe.oauth.authorizeUrl({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
  });

  console.log(`[Stripe Connect] OAuth initiated for user ${ownerId}`);
  res.json({ url });
});

// ── GET /api/stripe/connect/callback — OAuth redirect from Stripe ─────────
// No authentication — Stripe redirects here with code + state.
router.get('/connect/callback', async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim();

  const fail = (reason) =>
    res.redirect(`${frontendUrl}/invoices?stripe_connect=error&reason=${encodeURIComponent(reason)}`);

  if (oauthError) {
    console.error('[Stripe Connect] OAuth error:', oauthError, error_description);
    return fail(oauthError);
  }

  if (!code || !state) {
    return fail('missing_params');
  }

  const stateData = verifyState(state);
  if (!stateData?.userId) {
    return fail('invalid_state');
  }
  const { userId } = stateData;

  const stripe = getStripe();
  if (!stripe) return fail('stripe_not_configured');

  try {
    const tokenResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const { stripe_user_id } = tokenResponse;
    if (!stripe_user_id) {
      return fail('no_account_id');
    }

    // Retrieve the connected account for its display name
    let accountName = null;
    let chargesEnabled = false;
    try {
      const account = await stripe.accounts.retrieve(stripe_user_id);
      accountName =
        account.business_profile?.name ||
        account.display_name ||
        account.email ||
        null;
      chargesEnabled = account.charges_enabled;
    } catch (accErr) {
      console.warn('[Stripe Connect] Could not retrieve account details:', accErr.message);
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        stripeConnectAccountId: stripe_user_id,
        stripeConnectAccountName: accountName,
        stripeConnectChargesEnabled: chargesEnabled,
      },
    });

    console.log(`[Stripe Connect] Account ${stripe_user_id} connected for user ${userId}`);
    return res.redirect(`${frontendUrl}/invoices?stripe_connect=success`);
  } catch (err) {
    console.error('[Stripe Connect] Token exchange failed:', err.message);
    return fail(err.message);
  }
});

// ── DELETE /api/stripe/connect — disconnect Stripe account ───────────────
// Deauthorises on Stripe and removes stored account data.
// Deliberately does NOT delete invoices, payments, or payment history.
router.delete('/connect', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { stripeConnectAccountId: true },
    });

    if (!owner?.stripeConnectAccountId) {
      return res.json({ success: true, message: 'No Stripe account was connected' });
    }

    const accountId = owner.stripeConnectAccountId;
    const stripe = getStripe();
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;

    if (stripe && clientId) {
      try {
        await stripe.oauth.deauthorize({
          client_id: clientId,
          stripe_user_id: accountId,
        });
        console.log(`[Stripe Connect] Deauthorised account ${accountId} for user ${ownerId}`);
      } catch (deauthErr) {
        // Non-blocking: account may have already been deauthorised on Stripe's side
        console.warn('[Stripe Connect] Deauthorise call failed (continuing):', deauthErr.message);
      }
    }

    // Clear stored connect fields — never touch invoices or payments
    await prisma.user.update({
      where: { id: ownerId },
      data: {
        stripeConnectAccountId: null,
        stripeConnectAccountName: null,
        stripeConnectChargesEnabled: false,
      },
    });

    console.log(`[Stripe Connect] Disconnected for user ${ownerId}`);
    res.json({ success: true, message: 'Stripe disconnected successfully' });
  } catch (err) {
    console.error('[Stripe Connect] Disconnect failed:', err.message);
    res.status(500).json({ error: 'Failed to disconnect Stripe' });
  }
});

// ── POST /api/stripe/checkout — create (or reuse) a checkout session ──────
router.post('/checkout', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const { invoice_id } = req.body;
    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id is required' });
    }

    const ownerId = resolveOwnerId(req.user);

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoice_id, userId: ownerId },
      include: { payments: { select: { amount: true } } },
    });

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    if (['Paid', 'Cancelled'].includes(invoice.status)) {
      return res.status(409).json({
        error: `Invoice is ${invoice.status.toLowerCase()} — no payment needed`,
      });
    }

    const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = +(invoice.total - totalPaid).toFixed(2);

    if (remaining <= 0) {
      return res.status(409).json({ error: 'Invoice has no outstanding balance' });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on this platform' });
    }

    // ── Reuse existing session if still valid and unpaid ─────────────────
    const now = new Date();
    if (
      invoice.stripeCheckoutId &&
      invoice.paymentLink &&
      invoice.stripeSessionExpiresAt &&
      invoice.stripeSessionExpiresAt > now
    ) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutId);
        if (existing.status === 'open' && existing.payment_status === 'unpaid') {
          console.log(`[Stripe Checkout] Reusing session ${invoice.stripeCheckoutId} for invoice ${invoice_id}`);
          return res.json({ success: true, url: invoice.paymentLink, reused: true });
        }
      } catch {
        // Session gone on Stripe — fall through to create a new one
      }
    }

    // ── Load owner for connected account routing ──────────────────────────
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { stripeConnectAccountId: true, stripeConnectChargesEnabled: true },
    });

    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173')
      .split(',')[0]
      .trim();

    const expiresUnix = Math.floor(Date.now() / 1000) + 72 * 3600; // 72 hours

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.clientEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: (invoice.currency || 'USD').toLowerCase(),
            product_data: {
              name: `Invoice #${invoice.invoiceNumber}`,
              description: invoice.clientName
                ? `Payment from ${invoice.clientName}`
                : undefined,
            },
            unit_amount: Math.round(remaining * 100),
          },
          quantity: 1,
        },
      ],
      expires_at: expiresUnix,
      success_url: `${frontendBase}/i/${invoice.publicSlug}?payment=success`,
      cancel_url: `${frontendBase}/i/${invoice.publicSlug}?payment=cancelled`,
      metadata: {
        invoiceId: invoice.id,
        userId: ownerId,
        invoiceNumber: invoice.invoiceNumber,
      },
    };

    // Route funds to the connected account via destination charges
    if (owner?.stripeConnectAccountId && owner.stripeConnectChargesEnabled) {
      sessionParams.payment_intent_data = {
        transfer_data: { destination: owner.stripeConnectAccountId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `invoice_${invoice.id}`,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        stripeCheckoutId: session.id,
        paymentLink: session.url,
        stripeSessionExpiresAt: new Date(expiresUnix * 1000),
      },
    });

    console.log(`[Stripe Checkout] Created session ${session.id} for invoice ${invoice_id}`);
    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Stripe Checkout] Failed:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

export default router;
