import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import {
  getStripe,
  getOrCreateStripeCustomer,
  subscriptionToUserData,
  resolvePeriodTimestamps,
  mapStripeStatus,
  PLANS,
  PLAN_RANK,
  isValidUpgrade,
  TRIAL_DAYS,
  GRACE_PERIOD_DAYS,
} from '../utils/stripe.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// Stripe key validation — runs once on import.
//
// Catches the most common misconfigurations BEFORE they cause silent
// failures at checkout time. The actual SDK instance lives in
// utils/stripe.js so it can be shared with auth and access middleware.
// ─────────────────────────────────────────────────────────────────
function detectKeyMode(key) {
  if (!key) return null;
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  return 'unknown';
}

function validateStripeConfig() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const nodeEnv = process.env.NODE_ENV;

  if (!secret) {
    console.warn('[Stripe] STRIPE_SECRET_KEY is not set — payment endpoints will return 501.');
    return;
  }
  if (secret.startsWith('pk_')) {
    console.error(
      '[Stripe] FATAL: STRIPE_SECRET_KEY appears to be a PUBLISHABLE key (starts with "pk_"). ' +
      'Set the SECRET key (sk_test_… or sk_live_…) from https://dashboard.stripe.com/apikeys'
    );
    return;
  }
  if (!secret.startsWith('sk_') && !secret.startsWith('rk_')) {
    console.warn('[Stripe] STRIPE_SECRET_KEY does not start with "sk_" or "rk_". May not be valid.');
  }

  const secretMode = detectKeyMode(secret);
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) {
    console.warn('[Stripe] STRIPE_WEBHOOK_SECRET does not start with "whsec_". Verification will fail.');
  }
  if (!webhookSecret) {
    console.warn(
      '[Stripe] STRIPE_WEBHOOK_SECRET is not set — webhooks will be accepted WITHOUT signature ' +
      'verification. OK for local dev only.'
    );
  }
  if (nodeEnv === 'production' && secretMode === 'test') {
    console.warn('[Stripe] WARNING: NODE_ENV=production with a TEST key — real customers will not be charged.');
  }
  if (nodeEnv !== 'production' && secretMode === 'live') {
    console.warn('[Stripe] WARNING: LIVE key outside production — real cards will be charged.');
  }
  console.log(
    `[Stripe] Initialized in ${secretMode || 'unknown'} mode` +
    `${webhookSecret ? ' with verified webhooks' : ' (UNVERIFIED webhooks)'}`
  );
}

validateStripeConfig();

const stripe = getStripe();

function frontendBase() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
}

// ────────────────────────────────────────────────────────────────────
// Shared helper — compute the canonical "is this user paying right now"
// state from the user row. Same logic the requireActiveSubscription
// middleware enforces, exposed so the frontend can render against it.
// ────────────────────────────────────────────────────────────────────
function computeAccessState(user) {
  const now = new Date();
  const PAID = ['starter', 'pro', 'elite'];

  const paidActive =
    PAID.includes(user.plan) &&
    ['active', 'trialing'].includes(user.subscriptionStatus) &&
    (!user.currentPeriodEnd || new Date(user.currentPeriodEnd) > now);

  const inGracePeriod =
    PAID.includes(user.plan) &&
    user.subscriptionStatus === 'past_due' &&
    user.gracePeriodEndsAt &&
    new Date(user.gracePeriodEndsAt) > now;

  const trialActive =
    user.plan === 'trial' &&
    user.trialEndsAt &&
    new Date(user.trialEndsAt) > now;

  const isActive = paidActive || inGracePeriod || trialActive;

  const trialNotStarted = user.plan === 'trial' && !user.trialEndsAt;
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(user.trialEndsAt) - now) / (1000 * 60 * 60 * 24))
    : 0;
  const graceDaysLeft = inGracePeriod
    ? Math.ceil((new Date(user.gracePeriodEndsAt) - now) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    isActive,
    paidActive,
    trialActive,
    trialNotStarted,
    inGracePeriod,
    trialDaysLeft,
    graceDaysLeft,
  };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/subscription/status — full snapshot for the dashboard UI
// AND for the post-checkout success poller. The `isActive` boolean is
// the single source of truth — frontend should rely on it instead of
// inferring from plan/status combinations.
// ────────────────────────────────────────────────────────────────────
router.get('/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const access = computeAccessState(user);

  res.json({
    // ── canonical access flag (use this on the frontend) ──
    isActive: access.isActive,
    plan: user.plan,
    expiresAt: user.currentPeriodEnd,

    // ── full snapshot ──
    subscriptionStatus: user.subscriptionStatus,
    isSubscribed: user.isSubscribed,
    stripeCustomerId: user.stripeCustomerId,
    subscriptionId: user.stripeSubscriptionId,
    currentPeriodStart: user.currentPeriodStart,
    currentPeriodEnd: user.currentPeriodEnd,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    trialEndsAt: user.trialEndsAt,
    trialActive: access.trialActive,
    trialNotStarted: access.trialNotStarted,
    trialEligible: access.trialNotStarted,
    trialDaysLeft: access.trialDaysLeft,
    inGracePeriod: access.inGracePeriod,
    graceDaysLeft: access.graceDaysLeft,
    gracePeriodEndsAt: user.gracePeriodEndsAt,
    billingCycle: user.billingCycle,
    onboardingStep: user.onboardingStep,
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/start-trial
// Local-dev fallback: activate the 14-day trial WITHOUT collecting a card.
// In production we route through Stripe Checkout instead so a card is on file.
// ────────────────────────────────────────────────────────────────────
router.post('/start-trial', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (['starter', 'pro', 'elite'].includes(user.plan) && user.subscriptionStatus === 'active') {
    return res.json({
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      alreadyActive: true,
    });
  }

  if (user.plan === 'trial' && user.trialEndsAt) {
    return res.json({
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      alreadyActive: true,
    });
  }

  if (user.plan === 'expired') {
    return res.status(403).json({ error: 'Trial already used. Please subscribe to continue.' });
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { plan: 'trial', subscriptionStatus: 'trialing', trialEndsAt },
  });

  res.json({
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    trialEndsAt: updated.trialEndsAt,
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/create-checkout
// Creates a Stripe Checkout Session in subscription mode.
// - Trial flow: pass includeTrial=true to get trial_period_days=14
// - Direct flow: pass includeTrial=false to charge immediately
// Always collects a payment method up-front so the trial converts cleanly.
// ────────────────────────────────────────────────────────────────────
router.post('/create-checkout', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  // The trial flag MUST be a real boolean from the frontend. We coerce here so
  // any truthy/falsy value collapses cleanly, and default to FALSE so a missing
  // or malformed flag never accidentally enrolls the user in a trial.
  const { plan, cycle = 'monthly' } = req.body;
  const includeTrial = req.body.includeTrial === true || req.body.includeTrial === 'true';

  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!['monthly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ error: 'Invalid billing cycle' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const amount = PLANS[plan][cycle];
    const interval = cycle === 'yearly' ? 'year' : 'month';

    const customerId = await getOrCreateStripeCustomer(user);
    if (!customerId) return res.status(501).json({ error: 'Stripe not configured' });

    // ── Trial gating ─────────────────────────────────────────────
    // Two independent conditions BOTH must be true for the trial to attach:
    //   1. The frontend explicitly asked for it (includeTrial === true)
    //   2. The user has never used a trial (`trial` plan, no trialEndsAt)
    // Otherwise the subscription is created WITHOUT trial_period_days, so
    // Stripe charges immediately on checkout.
    //
    // We do NOT pass `payment_settings` here — Stripe Checkout in subscription
    // mode already attaches the collected card as the default payment method,
    // and `payment_settings` is rejected by the Checkout Session API.
    const trialEligible = user.plan === 'trial' && !user.trialEndsAt;
    const shouldAttachTrial = includeTrial && trialEligible;

    const subscriptionData = {
      metadata: { userId: user.id, plan, cycle },
    };
    if (shouldAttachTrial) {
      subscriptionData.trial_period_days = TRIAL_DAYS;
    }

    console.log(
      `[Stripe] create-checkout user=${user.id} plan=${plan} cycle=${cycle} ` +
      `includeTrial=${includeTrial} trialEligible=${trialEligible} → trial=${shouldAttachTrial ? 'YES' : 'NO'}`
    );

    const base = frontendBase();

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `AuraDesk ${PLANS[plan].name} Plan` },
          unit_amount: amount,
          recurring: { interval },
        },
        quantity: 1,
      }],
      subscription_data: subscriptionData,
      payment_method_collection: 'always',
      metadata: { userId: user.id, plan, cycle, includeTrial: shouldAttachTrial ? '1' : '0' },
      // Land on a dedicated post-checkout page that:
      //   1. Calls /api/subscription/sync-session to write the row from Stripe
      //      (so we don't depend on the webhook firing first), and
      //   2. Routes the user to /onboarding or /dashboard based on state.
      // Webhooks still fire and stay the long-term source of truth.
      success_url: `${base}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?payment=cancel&plan=${plan}&cycle=${cycle}`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[Stripe] create-checkout failed:', err);
    // Never surface raw Stripe error messages (they expose internal IDs).
    // Log the detail server-side; send a generic message to the client.
    res.status(500).json({ error: 'Could not start checkout. Please try again or contact support.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/sync-session
// Body: { sessionId }
//
// Called by the /payment/success landing page immediately after Stripe
// redirects the user back. We retrieve the Checkout Session + Subscription
// directly from Stripe and persist the row right away — this removes the
// race against the asynchronous webhook so the dashboard guard sees the
// new plan immediately. Webhooks still fire and re-confirm.
//
// Idempotent: re-running on the same session is a no-op.
// ────────────────────────────────────────────────────────────────────
router.post('/sync-session', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    // ── Authorisation: this session must belong to the calling user ──
    // We check via metadata.userId (set when the session was created) AND
    // via stripeCustomerId on the user row. If neither matches, refuse.
    const sessionUserId = session.metadata?.userId;
    if (sessionUserId && sessionUserId !== req.user.id) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    if (session.payment_status === 'unpaid' && session.status !== 'complete') {
      return res.status(400).json({
        error: 'Checkout session is not yet complete',
        sessionStatus: session.status,
        paymentStatus: session.payment_status,
      });
    }

    // ── Resolve the subscription object (handle both expanded + id-only) ──
    let sub = null;
    if (session.subscription) {
      sub = typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
    }
    if (!sub) {
      return res.status(400).json({ error: 'No subscription attached to this checkout session' });
    }

    const plan = session.metadata?.plan;
    const cycle = session.metadata?.cycle;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: subscriptionToUserData(sub, {
        planFromMetadata: plan,
        cycleFromMetadata: cycle,
      }),
    });

    console.log(
      `[Stripe] sync-session user=${req.user.id} session=${sessionId} ` +
      `→ plan=${updated.plan} status=${updated.subscriptionStatus}`
    );

    res.json({
      ok: true,
      isActive: ['active', 'trialing'].includes(updated.subscriptionStatus) &&
                ['starter', 'pro', 'elite'].includes(updated.plan),
      plan: updated.plan,
      subscriptionStatus: updated.subscriptionStatus,
      currentPeriodEnd: updated.currentPeriodEnd,
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    console.error('[Stripe] sync-session failed:', err);
    res.status(500).json({ error: err.message || 'Could not sync checkout session' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/upgrade-plan
//
// Upgrades an active subscription to a higher tier or from monthly→yearly.
// Downgrades and same-plan/same-cycle selections are explicitly rejected.
//
// Two cases are handled:
//   1. Trial user upgrading → they have no stripeSubscriptionId yet.
//      We create a Stripe Checkout session (card needed) and return a URL.
//   2. Paid subscriber upgrading → we update the Stripe subscription in place,
//      bill the prorated difference immediately, and keep the billing date.
//
// Body:  { plan: 'starter'|'pro'|'elite', cycle: 'monthly'|'yearly' }
// ────────────────────────────────────────────────────────────────────
router.post('/upgrade-plan', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  const { plan: targetPlan, cycle: targetCycle = 'monthly' } = req.body;

  // ── Input validation ────────────────────────────────────────────
  if (!PLANS[targetPlan]) {
    return res.status(400).json({ error: 'Invalid plan', validPlans: Object.keys(PLANS) });
  }
  if (!['monthly', 'yearly'].includes(targetCycle)) {
    return res.status(400).json({ error: 'cycle must be "monthly" or "yearly"' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const currentPlan  = user.plan;
    const currentCycle = user.billingCycle || 'monthly';

    // ── Upgrade gate ─────────────────────────────────────────────
    // This is the single enforcement point. All rank logic lives in stripe.js.
    if (!isValidUpgrade(currentPlan, currentCycle, targetPlan, targetCycle)) {
      const currentRank = PLAN_RANK[currentPlan] ?? 0;
      const targetRank  = PLAN_RANK[targetPlan]  ?? 0;

      let reason;
      if (targetRank < currentRank) {
        reason = `Downgrade from ${currentPlan} to ${targetPlan} is not allowed.`;
      } else if (targetPlan === currentPlan && targetCycle === currentCycle) {
        reason = `You are already on the ${PLANS[targetPlan].name} ${currentCycle} plan.`;
      } else if (targetPlan === currentPlan && targetCycle === 'monthly' && currentCycle === 'yearly') {
        reason = `Switching from yearly to monthly billing is not allowed.`;
      } else {
        reason = `This plan change is not permitted.`;
      }

      return res.status(400).json({
        error: 'upgrade_only',
        message: reason,
        currentPlan,
        currentCycle,
        targetPlan,
        targetCycle,
      });
    }

    // ── Case 1: Trial user — no Stripe subscription yet ─────────
    // Redirect through Checkout so a payment method is collected.
    // The trial is NOT re-attached: they are upgrading to a paid plan now.
    if (!user.stripeSubscriptionId || user.plan === 'trial') {
      const customerId = await getOrCreateStripeCustomer(user);
      if (!customerId) return res.status(501).json({ error: 'Stripe not configured' });

      const base = frontendBase();
      const interval = targetCycle === 'yearly' ? 'year' : 'month';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `AuraDesk ${PLANS[targetPlan].name} Plan` },
            unit_amount: PLANS[targetPlan][targetCycle],
            recurring: { interval },
          },
          quantity: 1,
        }],
        subscription_data: {
          metadata: { userId: user.id, plan: targetPlan, cycle: targetCycle },
        },
        payment_method_collection: 'always',
        metadata: { userId: user.id, plan: targetPlan, cycle: targetCycle, includeTrial: '0' },
        success_url: `${base}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/pricing?payment=cancel&plan=${targetPlan}&cycle=${targetCycle}`,
      });

      console.log(
        `[Stripe] upgrade-plan (trial→paid) user=${user.id} ` +
        `${currentPlan} → ${targetPlan} (${targetCycle})`
      );

      return res.json({
        ok: true,
        requiresCheckout: true,
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    }

    // ── Case 2: Active paid subscriber — update in place ────────
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    if (['canceled', 'incomplete_expired'].includes(sub.status)) {
      return res.status(400).json({
        error: 'subscription_inactive',
        message: 'Your subscription is no longer active. Please subscribe again.',
      });
    }

    const interval = targetCycle === 'yearly' ? 'year' : 'month';

    // stripe.subscriptions.update does NOT accept price_data.product_data —
    // only a price ID or price_data.product (existing product ID) is allowed.
    // Create the price first, then reference it by ID.
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      product_data: { name: `AuraDesk ${PLANS[targetPlan].name} Plan` },
      unit_amount: PLANS[targetPlan][targetCycle],
      recurring: { interval },
    });

    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [{
        id: sub.items.data[0].id,
        price: newPrice.id,
      }],
      // Bill the prorated difference immediately. Billing date stays the same
      // so the customer is not surprised by a sudden renewal date change.
      proration_behavior: 'always_invoice',
      billing_cycle_anchor: 'unchanged',
      metadata: { ...sub.metadata, userId: user.id, plan: targetPlan, cycle: targetCycle },
    });

    // Mirror immediately — webhook will reconcile and confirm.
    await prisma.user.update({
      where: { id: user.id },
      data: subscriptionToUserData(updated, {
        planFromMetadata: targetPlan,
        cycleFromMetadata: targetCycle,
      }),
    });

    console.log(
      `[Stripe] upgrade-plan user=${user.id} ` +
      `${currentPlan}/${currentCycle} → ${targetPlan}/${targetCycle}`
    );

    res.json({
      ok: true,
      requiresCheckout: false,
      plan: targetPlan,
      cycle: targetCycle,
      billedNow: true,
      effectiveAt: 'immediately',
    });
  } catch (err) {
    console.error('[Stripe] upgrade-plan failed:', err);
    res.status(500).json({ error: err.message || 'Could not upgrade plan' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/cancel
// Schedule cancellation at the end of the current billing period.
// Customer keeps full access until currentPeriodEnd.
// ────────────────────────────────────────────────────────────────────
router.post('/cancel', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to cancel.' });
    }

    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const { end: periodEndTs } = resolvePeriodTimestamps(updated);
    const accessUntil = periodEndTs ? new Date(periodEndTs * 1000) : user.currentPeriodEnd;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: accessUntil,
      },
    });

    res.json({
      ok: true,
      cancelAtPeriodEnd: true,
      accessUntil,
    });
  } catch (err) {
    console.error('[Stripe] cancel failed:', err);
    res.status(500).json({ error: err.message || 'Could not cancel subscription' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/resume
// Undo a scheduled cancellation while the subscription is still in its
// current period.
// ────────────────────────────────────────────────────────────────────
router.post('/resume', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No subscription to resume.' });
    }

    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { cancelAtPeriodEnd: false },
    });

    res.json({ ok: true, cancelAtPeriodEnd: false, status: updated.status });
  } catch (err) {
    console.error('[Stripe] resume failed:', err);
    res.status(500).json({ error: err.message || 'Could not resume subscription' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/webhook
// Stripe webhook handler. Mounted with express.raw() in index.js so the
// signature can be verified against the unparsed body.
// ────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  let event;
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[Stripe] STRIPE_WEBHOOK_SECRET not set — accepting webhook unverified.');
    try {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (err) {
      console.error('[Stripe] Invalid webhook body:', err.message);
      return res.status(400).send('Invalid body');
    }
  } else {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[Stripe] Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  try {
    switch (event.type) {
      // ── Initial checkout completed: persist plan + sub id ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, plan, cycle } = session.metadata || {};
        if (!userId || !plan) break;

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await prisma.user.update({
            where: { id: userId },
            data: subscriptionToUserData(sub, {
              planFromMetadata: plan,
              cycleFromMetadata: cycle,
            }),
          });
        }
        console.log(`[Stripe] checkout.session.completed → user ${userId} on ${plan} (${cycle})`);
        break;
      }

      // ── Subscription created (fires alongside checkout.session.completed) ──
      // Idempotent with the checkout handler — we just keep the user row in sync.
      // We look up by stripeCustomerId FIRST so re-subscription after a cancel
      // (which generates a new subscription id) still finds the existing user.
      case 'customer.subscription.created': {
        const sub = event.data.object;
        let user = await prisma.user.findFirst({
          where: { stripeCustomerId: sub.customer },
        });
        if (!user) {
          user = await prisma.user.findFirst({
            where: { stripeSubscriptionId: sub.id },
          });
        }
        if (!user) break;
        await prisma.user.update({
          where: { id: user.id },
          data: subscriptionToUserData(sub),
        });
        console.log(`[Stripe] customer.subscription.created → user ${user.id} status=${sub.status}`);
        break;
      }

      // ── Subscription updated: keep period_end + status fresh ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        let user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!user) {
          // Fallback: re-sub case where the user row still points at the old id.
          user = await prisma.user.findFirst({
            where: { stripeCustomerId: sub.customer },
          });
        }
        if (!user) break;
        await prisma.user.update({
          where: { id: user.id },
          data: subscriptionToUserData(sub),
        });
        console.log(`[Stripe] customer.subscription.updated → user ${user.id} status=${sub.status}`);
        break;
      }

      // ── Trial about to end (3 days notice from Stripe) ──
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (user) {
          console.log(`[Stripe] Trial ending soon for user ${user.id} (${user.email})`);
          // Hook for sending an email notification, etc.
        }
        break;
      }

      // ── Subscription canceled / fully ended ──
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              plan: 'expired',
              subscriptionStatus: 'canceled',
              isSubscribed: false,
              cancelAtPeriodEnd: false,
              gracePeriodEndsAt: null,
            },
          });
          console.log(`[Stripe] Subscription canceled for user ${user.id}`);
        }
        break;
      }

      // ── Successful invoice (recurring billing) ──
      // Mark active + isSubscribed=true and clear any past grace period.
      // We also re-pull the full subscription so we can refresh the period
      // window correctly across both old and new Stripe API shapes.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (!user) break;

        // Newer API: invoice.subscription removed, lives on invoice.parent
        const subscriptionId =
          invoice.subscription ||
          invoice.parent?.subscription_details?.subscription ||
          invoice.lines?.data?.[0]?.subscription ||
          null;

        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            await prisma.user.update({
              where: { id: user.id },
              data: subscriptionToUserData(sub),
            });
          } catch (e) {
            // Fallback: derive what we can directly from the invoice line
            const data = {
              subscriptionStatus: 'active',
              isSubscribed: true,
              gracePeriodEndsAt: null,
            };
            if (invoice.lines?.data?.[0]?.period?.start) {
              data.currentPeriodStart = new Date(invoice.lines.data[0].period.start * 1000);
            }
            if (invoice.lines?.data?.[0]?.period?.end) {
              data.currentPeriodEnd = new Date(invoice.lines.data[0].period.end * 1000);
            }
            await prisma.user.update({ where: { id: user.id }, data });
          }
        }
        console.log(`[Stripe] invoice.payment_succeeded → user ${user.id}`);
        break;
      }

      // ── Failed invoice (card declined, etc.) ──
      // Move to past_due and start a grace period. Stripe will keep retrying
      // inside this window. We keep `isSubscribed=true` until the grace ends.
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (user) {
          const graceEnd = new Date();
          graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'past_due',
              // isSubscribed stays true during grace — access cuts off via the
              // requireActiveSubscription middleware once the timestamp passes.
              isSubscribed: true,
              gracePeriodEndsAt: graceEnd,
            },
          });
          console.log(`[Stripe] invoice.payment_failed → user ${user.id} (grace until ${graceEnd.toISOString()})`);
        }
        break;
      }

      default:
        // Unhandled event types are fine — just no-op
        break;
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err);
    // Still 200 so Stripe doesn't retry on a code bug; logs preserve the trace.
  }

  res.sendStatus(200);
});

// ────────────────────────────────────────────────────────────────────
// POST /api/subscription/activate
// Local-dev fallback for environments without Stripe configured.
// Still enforces upgrade-only so dev behaviour matches production.
// ────────────────────────────────────────────────────────────────────
router.post('/activate', authenticate, async (req, res) => {
  const { plan, cycle = 'monthly' } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!isValidUpgrade(user.plan, user.billingCycle || 'monthly', plan, cycle)) {
    return res.status(400).json({
      error: 'upgrade_only',
      message: `Cannot move from ${user.plan} to ${plan} — upgrade-only policy.`,
    });
  }

  const periodStart = new Date();
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + (cycle === 'yearly' ? 365 : 30));

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      plan,
      subscriptionStatus: 'active',
      isSubscribed: true,
      billingCycle: cycle,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      gracePeriodEndsAt: null,
    },
  });

  res.json({
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    currentPeriodEnd: updated.currentPeriodEnd,
  });
});

export default router;
