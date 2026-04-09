import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { sendMail, buildPasswordResetEmail } from '../utils/mailer.js';
import { getOrCreateStripeCustomer } from '../utils/stripe.js';
import { getUsageSnapshot } from '../services/planGuard.js';
import { getPresignedUrl } from '../utils/s3.js';

// If companyLogo is an S3 key (not already a URL), resolve it to a fresh presigned URL.
async function resolveLogoUrl(companyLogo) {
  if (!companyLogo || companyLogo.startsWith('http')) return companyLogo;
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

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .replace(/\/$/, '');
}

// Mirror of the frontend rules so the server can never be bypassed.
// Keep these in sync with frontend/src/pages/ResetPasswordPage.jsx.
function validatePasswordRules(pw) {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character';
  // No three+ ascending sequential digits anywhere (e.g. 123, 456, 789)
  for (let i = 0; i <= pw.length - 3; i++) {
    const a = pw.charCodeAt(i);
    const b = pw.charCodeAt(i + 1);
    const c = pw.charCodeAt(i + 2);
    const isDigit = (code) => code >= 48 && code <= 57;
    if (isDigit(a) && isDigit(b) && isDigit(c) && b === a + 1 && c === b + 1) {
      return 'Password must not contain sequential numbers';
    }
  }
  return null;
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

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

  // Auto-expire trial
  if (user.plan === 'trial' && user.trialEndsAt && new Date() > new Date(user.trialEndsAt)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'expired', subscriptionStatus: 'expired' },
    });
    user.plan = 'expired';
    user.subscriptionStatus = 'expired';
  }

  // Snapshot plan limits + current usage so the frontend can render plan
  // UI (connection counters, seat counts, AI quota bars) without a second
  // round-trip. Failure here is non-fatal — we still return the user.
  let planSnapshot = null;
  try {
    planSnapshot = await getUsageSnapshot(user);
  } catch (err) {
    console.error('[auth/me] getUsageSnapshot failed:', err.message);
  }

  const companyLogoUrl = await resolveLogoUrl(user.companyLogo);

  res.json({
    user: {
      id: user.id, email: user.email, name: user.name,
      plan: user.plan, subscriptionStatus: user.subscriptionStatus,
      isSubscribed: user.isSubscribed,
      trialEndsAt: user.trialEndsAt,
      onboardingStep: user.onboardingStep,
      onboardingCompleted: user.onboardingCompleted,
      companyName: user.companyName, companyLogo: companyLogoUrl,
      brandColor: user.brandColor, firstName: user.firstName,
      lastName: user.lastName, cannedResponse: user.cannedResponse,
      currentPeriodStart: user.currentPeriodStart,
      currentPeriodEnd: user.currentPeriodEnd,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,
      gracePeriodEndsAt: user.gracePeriodEndsAt,
      billingCycle: user.billingCycle,
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

      const resetLink = `${frontendBaseUrl()}/reset-password/${rawToken}`;
      const mail = buildPasswordResetEmail({ resetLink, userName: user.firstName || user.name });
      const result = await sendMail({ to: user.email, ...mail });
      if (!result.sent) {
        // Log but DON'T leak failure details to the client.
        console.warn(`[auth] forgot-password email NOT sent to ${user.email}: ${result.reason}`);
      }
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

    const ruleError = validatePasswordRules(password);
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
