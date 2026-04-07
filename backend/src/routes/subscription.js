import { Router } from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Stripe is optional — if STRIPE_SECRET_KEY is not set, payment endpoints return 501
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PLANS = {
  starter: { monthly: 2900, yearly: 29000, name: 'Starter' },
  pro:     { monthly: 7900, yearly: 79000, name: 'Pro' },
  elite:   { monthly: 14900, yearly: 149000, name: 'Elite' },
};

const TRIAL_DAYS = 14;

function frontendBase() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .replace(/\/$/, '');
}

// ── Get subscription status ──
router.get('/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const trialActive = user.plan === 'trial' && user.trialEndsAt && now < new Date(user.trialEndsAt);
  const trialNotStarted = user.plan === 'trial' && !user.trialEndsAt;
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(user.trialEndsAt) - now) / (1000 * 60 * 60 * 24))
    : 0;

  res.json({
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    trialActive,
    trialNotStarted,
    trialEligible: trialNotStarted, // alias for clarity in UI
    trialDaysLeft,
    currentPeriodEnd: user.currentPeriodEnd,
    billingCycle: user.billingCycle,
    onboardingStep: user.onboardingStep,
  });
});

// ── Start the 14-day free trial (no credit card required) ──
// Idempotent: silently no-ops if user has already started a trial or is on a paid plan.
router.post('/start-trial', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Already on a paid plan — nothing to do
  if (['starter', 'pro', 'elite'].includes(user.plan) && user.subscriptionStatus === 'active') {
    return res.json({
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      alreadyActive: true,
    });
  }

  // Trial already started — return existing window
  if (user.plan === 'trial' && user.trialEndsAt) {
    return res.json({
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      alreadyActive: true,
    });
  }

  // Trial expired — must subscribe
  if (user.plan === 'expired') {
    return res.status(403).json({ error: 'Trial already used. Please subscribe to continue.' });
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      plan: 'trial',
      subscriptionStatus: 'trialing',
      trialEndsAt,
    },
  });

  res.json({
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    trialEndsAt: updated.trialEndsAt,
  });
});

// ── Create Stripe Checkout Session ──
router.post('/create-checkout', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  const { plan, cycle = 'monthly', includeTrial = false } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!['monthly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ error: 'Invalid billing cycle' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const amount = PLANS[plan][cycle];
  const interval = cycle === 'yearly' ? 'year' : 'month';

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  // Trial eligibility: only attach a trial period if the user has never used one
  // AND the request explicitly opts in. Users whose plan is already 'expired'
  // (trial consumed) cannot get another.
  const trialEligible = user.plan === 'trial' && !user.trialEndsAt;
  const subscriptionData = (includeTrial && trialEligible)
    ? { trial_period_days: TRIAL_DAYS, metadata: { userId: user.id, plan, cycle } }
    : { metadata: { userId: user.id, plan, cycle } };

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
    // Always collect a payment method up-front (true for both with and without trial)
    payment_method_collection: 'always',
    metadata: { userId: user.id, plan, cycle, includeTrial: includeTrial ? '1' : '0' },
    success_url: `${base}/onboarding?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/pricing?payment=cancel&plan=${plan}&cycle=${cycle}`,
  });

  res.json({ url: session.url, sessionId: session.id });
});

// ── Stripe Webhook Handler ──
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  // If no webhook secret is configured, accept the webhook unverified
  // (only safe for local dev / testing — set STRIPE_WEBHOOK_SECRET in prod).
  let event;
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[Stripe] STRIPE_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
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
        const { userId, plan, cycle, includeTrial } = session.metadata || {};
        if (!userId || !plan) break;

        // For sessions with a trial, Stripe sets status to 'trialing' until trial ends
        const subStatus = includeTrial === '1' ? 'trialing' : 'active';
        const periodMs = (cycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000;

        // Pull subscription for accurate trial_end / current_period_end if available
        let trialEndsAt = null;
        let currentPeriodEnd = new Date(Date.now() + periodMs);
        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            if (sub.trial_end) trialEndsAt = new Date(sub.trial_end * 1000);
            if (sub.current_period_end) currentPeriodEnd = new Date(sub.current_period_end * 1000);
          } catch (e) {
            console.warn('[Stripe] Could not fetch subscription details:', e.message);
          }
        }

        await prisma.user.update({
          where: { id: userId },
          data: {
            plan,
            subscriptionStatus: subStatus,
            stripeSubscriptionId: session.subscription || null,
            billingCycle: cycle || 'monthly',
            currentPeriodEnd,
            ...(trialEndsAt ? { trialEndsAt } : {}),
          },
        });
        console.log(`[Stripe] checkout.session.completed → user ${userId} on ${plan} (${cycle}) status=${subStatus}`);
        break;
      }

      // ── Subscription updated: keep period_end + status fresh ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!user) break;
        const data = {
          subscriptionStatus:
            sub.status === 'active' ? 'active'
            : sub.status === 'trialing' ? 'trialing'
            : sub.status === 'past_due' ? 'past_due'
            : sub.status === 'canceled' ? 'canceled'
            : sub.status === 'incomplete_expired' ? 'expired'
            : user.subscriptionStatus,
        };
        if (sub.current_period_end) data.currentPeriodEnd = new Date(sub.current_period_end * 1000);
        if (sub.trial_end) data.trialEndsAt = new Date(sub.trial_end * 1000);
        await prisma.user.update({ where: { id: user.id }, data });
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
            data: { plan: 'expired', subscriptionStatus: 'canceled' },
          });
          console.log(`[Stripe] Subscription canceled for user ${user.id}`);
        }
        break;
      }

      // ── Successful invoice (recurring billing) ──
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (user && invoice.subscription) {
          const data = { subscriptionStatus: 'active' };
          if (invoice.lines?.data?.[0]?.period?.end) {
            data.currentPeriodEnd = new Date(invoice.lines.data[0].period.end * 1000);
          }
          await prisma.user.update({ where: { id: user.id }, data });
        }
        break;
      }

      // ── Failed invoice (card declined, etc.) ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionStatus: 'past_due' },
          });
          console.log(`[Stripe] Payment failed for user ${user.id}`);
        }
        break;
      }

      default:
        // Unhandled event types are fine — just log at debug level
        break;
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err);
    // Still return 200 so Stripe doesn't retry on a code bug — but keep logs
  }

  res.sendStatus(200);
});

// ── Manual plan activation (for testing without Stripe) ──
router.post('/activate', authenticate, async (req, res) => {
  const { plan, cycle = 'monthly' } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + (cycle === 'yearly' ? 365 : 30));

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      plan,
      subscriptionStatus: 'active',
      billingCycle: cycle,
      currentPeriodEnd: periodEnd,
    },
  });

  res.json({
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    currentPeriodEnd: user.currentPeriodEnd,
  });
});

export default router;
