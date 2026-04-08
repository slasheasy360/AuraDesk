import Stripe from 'stripe';
import prisma from './prisma.js';

// Single shared Stripe SDK instance — null if STRIPE_SECRET_KEY is missing or
// clearly invalid (validation logged from routes/subscription.js on startup).
let stripe = null;
const secret = process.env.STRIPE_SECRET_KEY;
if (secret && !secret.startsWith('pk_')) {
  stripe = new Stripe(secret);
}

export function getStripe() {
  return stripe;
}

/**
 * Plan / cycle catalog. Single source of truth — both checkout and
 * upgrade/downgrade endpoints import from here.
 *
 * Amounts are in the smallest currency unit (cents).
 */
export const PLANS = {
  starter: { monthly: 2900,  yearly: 29000,  name: 'Starter' },
  pro:     { monthly: 7900,  yearly: 79000,  name: 'Pro' },
  elite:   { monthly: 14900, yearly: 149000, name: 'Elite' },
};

export const TRIAL_DAYS = 14;

// Grace period after a failed invoice. Stripe will keep retrying inside this
// window; we keep the user's access live until it elapses.
export const GRACE_PERIOD_DAYS = 5;

/**
 * Get an existing Stripe customer for a user, or create one. Persists the
 * customer id on the user row before returning.
 *
 * Used by:
 *   - auth/register      (create on signup so the customer always exists)
 *   - subscription/*     (lazy fallback if a legacy user pre-dates this code)
 *
 * Safe to call multiple times — returns the cached id on subsequent calls.
 */
export async function getOrCreateStripeCustomer(user) {
  if (!stripe) return null;
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Map Stripe's subscription status to our internal SubStatus enum.
 * Anything unrecognized becomes 'expired'.
 */
export function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':              return 'active';
    case 'trialing':            return 'trialing';
    case 'past_due':            return 'past_due';
    case 'canceled':            return 'canceled';
    case 'unpaid':              return 'past_due';
    case 'incomplete':          return 'past_due';
    case 'incomplete_expired':  return 'expired';
    default:                    return 'expired';
  }
}

/**
 * Convert a Stripe subscription object into the columns we want to write
 * onto the user row. Centralised so checkout, webhook, and change-plan all
 * stay in sync.
 *
 * `planFromMetadata` lets the caller override the plan name when the
 * subscription's metadata is the source of truth (e.g. checkout flow).
 */
export function subscriptionToUserData(sub, { planFromMetadata, cycleFromMetadata } = {}) {
  const data = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: mapStripeStatus(sub.status),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };

  if (sub.current_period_start) {
    data.currentPeriodStart = new Date(sub.current_period_start * 1000);
  }
  if (sub.current_period_end) {
    data.currentPeriodEnd = new Date(sub.current_period_end * 1000);
  }
  if (sub.trial_end) {
    data.trialEndsAt = new Date(sub.trial_end * 1000);
  }

  // isSubscribed is true whenever the user has a usable, paid subscription —
  // active OR currently in a paid trial. past_due users keep access during
  // grace period; that gets handled separately when the grace window starts.
  data.isSubscribed = ['active', 'trialing'].includes(data.subscriptionStatus);

  // Plan name + cycle: prefer metadata (set when we created the sub),
  // otherwise leave whatever's already on the user row alone.
  if (planFromMetadata && ['starter', 'pro', 'elite'].includes(planFromMetadata)) {
    data.plan = planFromMetadata;
  } else if (sub.metadata?.plan && ['starter', 'pro', 'elite'].includes(sub.metadata.plan)) {
    data.plan = sub.metadata.plan;
  }

  if (cycleFromMetadata && ['monthly', 'yearly'].includes(cycleFromMetadata)) {
    data.billingCycle = cycleFromMetadata;
  } else if (sub.metadata?.cycle && ['monthly', 'yearly'].includes(sub.metadata.cycle)) {
    data.billingCycle = sub.metadata.cycle;
  }

  // A successful update clears any past grace period.
  if (data.isSubscribed) {
    data.gracePeriodEndsAt = null;
  }

  return data;
}
