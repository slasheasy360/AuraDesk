import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { sendWelcomeEmail } from '../emails/senders/sendWelcomeEmail.js';
import { sendPasswordResetEmail } from '../emails/senders/sendPasswordResetEmail.js';
import { getOrCreateStripeCustomer } from '../utils/stripe.js';
import { getUsageSnapshot } from '../services/planGuard.js';
import { getPresignedUrl } from '../utils/s3.js';
import { validatePassword } from '../utils/passwordValidator.js';

// If companyLogo is an S3 key (not already a URL), resolve it to a fresh presigned URL.
async function resolveLogoUrl(companyLogo) {
  if (!companyLogo || companyLogo.startsWith('http') || companyLogo.startsWith('data:')) return companyLogo;
  try { return await getPresignedUrl(companyLogo, 3600 * 12); } catch { return null; }
}

const router = Router();

// ── Password reset constants ──
const RESET_TOKEN_BYTES = 32;            // 256 bits of entropy
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SHA-256 a raw token so we never store the live token in the DB.
// (bcrypt is overkill for short-lived high-entropy tokens.)
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// validatePassword is imported from ../utils/passwordValidator.js
// (centralized — shared with profile.js and mirrored on the frontend)

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Trial is NOT auto-activated. The user lands on /pricing after register
    // and either clicks "TRY NOW" (→ POST /api/subscription/start-trial) to
    // activate the 14-day trial, or picks a paid plan via Stripe.
    let user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        plan: 'trial',
        subscriptionStatus: 'trialing',
        trialEndsAt: null,
        onboardingStep: 0,
      },
    });

    // Provision a Stripe customer immediately so the customer id is always
    // present before any subscription action. Failure here is non-fatal —
    // create-checkout will lazily retry if Stripe was temporarily unreachable.
    try {
      const stripeCustomerId = await getOrCreateStripeCustomer(user);
      if (stripeCustomerId) {
        user = { ...user, stripeCustomerId };
      }
    } catch (e) {
      console.warn(`[auth/register] Stripe customer creation deferred for ${user.email}: ${e.message}`);
    }

    // Fire welcome email non-blocking — registration must not fail if email delivery fails
    sendWelcomeEmail(user).catch((err) => {
      console.error('[auth/register] welcome email failed (non-blocking):', err.message);
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      user: {
        id: user.id, email: user.email, name: user.name,
        plan: user.plan, subscriptionStatus: user.subscriptionStatus,
        trialEndsAt: user.trialEndsAt,
        onboardingStep: user.onboardingStep,
        onboardingCompleted: user.onboardingCompleted,
      },
      token,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if trial expired — auto-update status
    if (user.plan === 'trial' && user.trialEndsAt && new Date() > new Date(user.trialEndsAt)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { plan: 'expired', subscriptionStatus: 'expired' },
      });
      user.plan = 'expired';
      user.subscriptionStatus = 'expired';
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        plan: user.plan, subscriptionStatus: user.subscriptionStatus,
        trialEndsAt: user.trialEndsAt,
        onboardingStep: user.onboardingStep,
        onboardingCompleted: user.onboardingCompleted,
        companyName: user.companyName, firstName: user.firstName, lastName: user.lastName,
        role: user.role, inviterUserId: user.inviterUserId,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user — includes full subscription + onboarding state
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // For team members, resolve subscription data from the workspace owner so
  // the frontend's hasUsableAccess check always reflects the owner's live plan.
  let owner = null;
  if (user.inviterUserId) {
    owner = await prisma.user.findUnique({ where: { id: user.inviterUserId } });
  }
  const subSource = owner || user;

  // Auto-expire trial (only for workspace owners; members inherit owner status)
  if (!owner && subSource.plan === 'trial' && subSource.trialEndsAt && new Date() > new Date(subSource.trialEndsAt)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'expired', subscriptionStatus: 'expired' },
    });
    subSource.plan = 'expired';
    subSource.subscriptionStatus = 'expired';
  }

  // Snapshot plan limits + current usage so the frontend can render plan
  // UI (connection counters, seat counts, AI quota bars) without a second
  // round-trip. Failure here is non-fatal — we still return the user.
  let planSnapshot = null;
  try {
    planSnapshot = await getUsageSnapshot(subSource);
  } catch (err) {
    console.error('[auth/me] getUsageSnapshot failed:', err.message);
  }

  const companyLogoUrl = await resolveLogoUrl(user.companyLogo);

  res.json({
    user: {
      id: user.id, email: user.email, name: user.name,
      // Subscription fields always come from the owner for team members
      plan: subSource.plan, subscriptionStatus: subSource.subscriptionStatus,
      isSubscribed: subSource.isSubscribed,
      trialEndsAt: subSource.trialEndsAt,
      currentPeriodStart: subSource.currentPeriodStart,
      currentPeriodEnd: subSource.currentPeriodEnd,
      cancelAtPeriodEnd: subSource.cancelAtPeriodEnd,
      gracePeriodEndsAt: subSource.gracePeriodEndsAt,
      billingCycle: subSource.billingCycle,
      // Profile fields always from the user's own row
      onboardingStep: user.onboardingStep,
      onboardingCompleted: user.onboardingCompleted,
      companyName: user.companyName, companyLogo: companyLogoUrl,
      brandColor: user.brandColor, firstName: user.firstName,
      lastName: user.lastName, cannedResponse: user.cannedResponse,
      role: user.role, inviterUserId: user.inviterUserId,
      // Embedded plan data (single source of truth from backend/src/config/plans.js)
      planLimits: planSnapshot?.limits || null,
      planUsage: planSnapshot?.usage || null,
    },
  });
});

// ─────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────

// POST /auth/forgot-password
// Always returns 200 with the same shape regardless of whether the email
// exists, to prevent account enumeration. The email is only sent when a
// matching user is actually found.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    if (user) {
      // Generate a high-entropy single-use token. The raw token is what we
      // email to the user; only the SHA-256 hash is stored in the database.
      const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: expiresAt,
        },
      });

      await sendPasswordResetEmail({ user, resetToken: rawToken, expiresInMinutes: 10 });
    }

    // Identical response regardless of email existence.
    res.json({
      ok: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Could not process password reset request' });
  }
});

// POST /auth/reset-password
// Body: { token, password }
// - Verifies the SHA-256 hash of the supplied token matches a stored hash.
// - Verifies the token has not expired (10 min TTL).
// - Re-validates password rules server-side.
// - Hashes new password with bcrypt and clears the reset token (single use).
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    const ruleError = validatePassword(password);
    if (ruleError) {
      return res.status(400).json({ error: ruleError });
    }

    const tokenHash = hashResetToken(token);

    // Look up by hash. The index on password_reset_token_hash makes this O(1).
    const user = await prisma.user.findFirst({
      where: { passwordResetTokenHash: tokenHash },
    });

    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Clear the token in the same update so it cannot be reused.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });

    res.json({ ok: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

export default router;
