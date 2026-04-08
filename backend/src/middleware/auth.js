import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    let token = null;

    if (header && header.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    } else if (req.query.token) {
      // Allow token via query param for inline media preview (images, videos)
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Subscription gate. Mount AFTER `authenticate`.
 *
 * Allows the request through when ANY of the following is true:
 *  - user is on a paid plan with status `active` or `trialing`
 *  - user is on a paid plan with status `past_due` and we are still inside
 *    the grace period (gracePeriodEndsAt is in the future)
 *  - user is on the free trial and the trial window hasn't elapsed yet
 *
 * Refuses the request (HTTP 402 Payment Required) otherwise. The response
 * body includes a `reason` so the frontend can route the user to /pricing
 * with a useful explanation.
 */
export async function requireActiveSubscription(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const now = new Date();
  const PAID_PLANS = ['starter', 'pro', 'elite'];

  // Active or trialing on a paid Stripe subscription
  if (PAID_PLANS.includes(user.plan) && ['active', 'trialing'].includes(user.subscriptionStatus)) {
    return next();
  }

  // past_due paid plan inside the grace window
  if (
    PAID_PLANS.includes(user.plan) &&
    user.subscriptionStatus === 'past_due' &&
    user.gracePeriodEndsAt &&
    new Date(user.gracePeriodEndsAt) > now
  ) {
    return next();
  }

  // Free trial that hasn't elapsed
  if (
    user.plan === 'trial' &&
    user.trialEndsAt &&
    new Date(user.trialEndsAt) > now
  ) {
    return next();
  }

  // Anything else is locked out.
  let reason = 'subscription_required';
  if (user.subscriptionStatus === 'past_due') reason = 'grace_period_expired';
  else if (user.plan === 'expired') reason = 'trial_expired';
  else if (user.plan === 'trial' && !user.trialEndsAt) reason = 'trial_not_started';
  else if (user.subscriptionStatus === 'canceled') reason = 'subscription_canceled';

  return res.status(402).json({
    error: 'Subscription required to access this feature',
    reason,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
  });
}
