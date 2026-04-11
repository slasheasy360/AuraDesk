/**
 * Single source of truth for plan limits.
 *
 * These values are consumed by:
 *   - backend/src/services/planGuard.js  (enforcement)
 *   - backend/src/routes/auth.js         (/auth/me response shape)
 *   - backend/src/routes/plan.js         (/api/plan/usage)
 *
 * Rules (intentional, product-defined):
 *   trial   → 1 connection, FB OR IG only, 1 seat,  10 AI/cycle
 *   starter → 2 connections, FB + IG only, 1 seat,  30 AI/cycle
 *   pro     → 3 connections, any 4 platforms, 3 seats, unlimited AI
 *   elite   → 4 connections, all platforms, unlimited seats, unlimited AI
 *
 * Expired is an explicit locked state used when a trial runs out or a
 * subscription lapses past the grace period.
 */

export const PLATFORMS = Object.freeze({
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  WHATSAPP: 'whatsapp',
  GMAIL: 'gmail',
});

export const UNLIMITED = Number.POSITIVE_INFINITY;

/**
 * @typedef {Object} PlanLimits
 * @property {string}   label
 * @property {number}   maxConnections
 * @property {string[]} allowedPlatforms
 * @property {boolean}  exclusivePlatforms  // only one of the allowed list may be active at a time
 * @property {number}   teamSeats           // total seats INCLUDING the owner
 * @property {number}   aiRepliesPerCycle
 * @property {Object}   features
 */

/** @type {Object<string, PlanLimits>} */
export const PLAN_LIMITS = Object.freeze({
  trial: {
    label: 'Free Trial',
    maxConnections: 1,
    allowedPlatforms: [PLATFORMS.FACEBOOK, PLATFORMS.INSTAGRAM],
    exclusivePlatforms: true,
    teamSeats: 1,
    aiRepliesPerCycle: 10,
    features: { invoices: false, analytics: 'basic' },
  },
  starter: {
    label: 'Starter',
    maxConnections: 1,
    allowedPlatforms: [PLATFORMS.FACEBOOK, PLATFORMS.INSTAGRAM],
    exclusivePlatforms: true,
    teamSeats: 1,
    aiRepliesPerCycle: 30,
    features: { invoices: true, analytics: 'basic' },
  },
  pro: {
    label: 'Pro',
    maxConnections: 3,
    allowedPlatforms: [
      PLATFORMS.FACEBOOK,
      PLATFORMS.INSTAGRAM,
      PLATFORMS.WHATSAPP,
      PLATFORMS.GMAIL,
    ],
    exclusivePlatforms: false,
    teamSeats: 3,
    aiRepliesPerCycle: UNLIMITED,
    features: { invoices: true, analytics: 'advanced' },
  },
  elite: {
    label: 'Elite',
    maxConnections: 4,
    allowedPlatforms: [
      PLATFORMS.FACEBOOK,
      PLATFORMS.INSTAGRAM,
      PLATFORMS.WHATSAPP,
      PLATFORMS.GMAIL,
    ],
    exclusivePlatforms: false,
    teamSeats: UNLIMITED,
    aiRepliesPerCycle: UNLIMITED,
    features: { invoices: true, analytics: 'advanced', multiLanguage: true },
  },
  expired: {
    label: 'Expired',
    maxConnections: 0,
    allowedPlatforms: [],
    exclusivePlatforms: true,
    teamSeats: 1,
    aiRepliesPerCycle: 0,
    features: {},
  },
});

// Ordered for upgrade-suggestion logic.
const PLAN_ORDER = ['trial', 'starter', 'pro', 'elite'];

/**
 * Returns the effective plan limits for a user, honoring grace period and
 * trial window. A canceled/expired user falls back to the `expired` limits
 * so downstream logic never has to null-check.
 *
 * Optional per-user overrides can live on `user.planOverrides` (JSON). Any
 * keys present there shallow-merge on top of the base plan limits — useful
 * for enterprise deals without forking the plan config.
 */
export function getPlanLimits(user) {
  if (!user) return PLAN_LIMITS.expired;

  const now = new Date();
  const trialActive =
    user.plan === 'trial' &&
    user.trialEndsAt &&
    new Date(user.trialEndsAt) > now;

  const inGrace =
    user.subscriptionStatus === 'past_due' &&
    user.gracePeriodEndsAt &&
    new Date(user.gracePeriodEndsAt) > now;

  const statusActive =
    user.subscriptionStatus === 'active' ||
    user.subscriptionStatus === 'trialing';

  const effectiveKey =
    (statusActive || inGrace || trialActive) && PLAN_LIMITS[user.plan]
      ? user.plan
      : 'expired';

  const base = PLAN_LIMITS[effectiveKey] || PLAN_LIMITS.expired;

  // Merge per-user overrides if present. Keeps immutability.
  if (user.planOverrides && typeof user.planOverrides === 'object') {
    return Object.freeze({ ...base, ...user.planOverrides });
  }
  return base;
}

/** Suggests the next plan that unlocks the given platform. */
export function suggestUpgradeForPlatform(platform) {
  for (const p of PLAN_ORDER) {
    if (PLAN_LIMITS[p].allowedPlatforms.includes(platform)) return p;
  }
  return 'pro';
}

/** Suggests the next plan up from `current`. */
export function nextPlanAbove(current) {
  const idx = PLAN_ORDER.indexOf(current);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return 'elite';
  return PLAN_ORDER[idx + 1];
}

/** Helpers for JSON serialization (Infinity → null). */
export function serializeLimits(limits) {
  return {
    label: limits.label,
    maxConnections: limits.maxConnections === UNLIMITED ? null : limits.maxConnections,
    allowedPlatforms: limits.allowedPlatforms,
    exclusivePlatforms: limits.exclusivePlatforms,
    teamSeats: limits.teamSeats === UNLIMITED ? null : limits.teamSeats,
    aiRepliesPerCycle: limits.aiRepliesPerCycle === UNLIMITED ? null : limits.aiRepliesPerCycle,
    features: limits.features,
  };
}
