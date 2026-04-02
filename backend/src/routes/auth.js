import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

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

    // Auto-assign 14-day free trial on registration
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        plan: 'trial',
        subscriptionStatus: 'trialing',
        trialEndsAt,
        onboardingStep: 0,
      },
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      user: {
        id: user.id, email: user.email, name: user.name,
        plan: user.plan, subscriptionStatus: user.subscriptionStatus,
        trialEndsAt: user.trialEndsAt, onboardingStep: user.onboardingStep,
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
        trialEndsAt: user.trialEndsAt, onboardingStep: user.onboardingStep,
        companyName: user.companyName, firstName: user.firstName, lastName: user.lastName,
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

  res.json({
    user: {
      id: user.id, email: user.email, name: user.name,
      plan: user.plan, subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt, onboardingStep: user.onboardingStep,
      companyName: user.companyName, companyLogo: user.companyLogo,
      brandColor: user.brandColor, firstName: user.firstName,
      lastName: user.lastName, cannedResponse: user.cannedResponse,
      currentPeriodEnd: user.currentPeriodEnd, billingCycle: user.billingCycle,
    },
  });
});

export default router;
