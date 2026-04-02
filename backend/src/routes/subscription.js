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

// ── Get subscription status ──
router.get('/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const trialActive = user.plan === 'trial' && user.trialEndsAt && now < new Date(user.trialEndsAt);
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(user.trialEndsAt) - now) / (1000 * 60 * 60 * 24))
    : 0;

  res.json({
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    trialActive,
    trialDaysLeft,
    currentPeriodEnd: user.currentPeriodEnd,
    billingCycle: user.billingCycle,
    onboardingStep: user.onboardingStep,
  });
});

// ── Create Stripe Checkout Session ──
router.post('/create-checkout', authenticate, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  const { plan, cycle = 'monthly' } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

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
    metadata: { userId: user.id, plan, cycle },
    success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pricing`,
  });

  res.json({ url: session.url });
});

// ── Stripe Webhook Handler ──
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { userId, plan, cycle } = session.metadata;
      if (userId && plan) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan,
            subscriptionStatus: 'active',
            stripeSubscriptionId: session.subscription,
            billingCycle: cycle || 'monthly',
            currentPeriodEnd: new Date(Date.now() + (cycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`[Stripe] User ${userId} subscribed to ${plan} (${cycle})`);
      }
      break;
    }

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
      }
      break;
    }
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
