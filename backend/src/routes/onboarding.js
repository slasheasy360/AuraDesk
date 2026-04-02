import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// ── Get onboarding state ──
router.get('/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      onboardingStep: true,
      companyName: true,
      companyLogo: true,
      brandColor: true,
      firstName: true,
      lastName: true,
      cannedResponse: true,
    },
  });
  res.json(user);
});

// ── Step 1: Branding ──
router.post('/branding', authenticate, async (req, res) => {
  const { firstName, lastName, companyName, brandColor, companyLogo } = req.body;
  if (!firstName || !companyName) {
    return res.status(400).json({ error: 'First name and company name are required' });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      firstName,
      lastName: lastName || null,
      companyName,
      brandColor: brandColor || null,
      companyLogo: companyLogo || null,
      onboardingStep: { set: Math.max(1, (await prisma.user.findUnique({ where: { id: req.user.id } })).onboardingStep) },
    },
  });

  // Ensure step is at least 1
  if (user.onboardingStep < 1) {
    await prisma.user.update({ where: { id: req.user.id }, data: { onboardingStep: 1 } });
  }

  res.json({ success: true, onboardingStep: Math.max(user.onboardingStep, 1) });
});

// ── Step 2: Platform connection ── (just marks step as visited)
router.post('/platforms', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const step = Math.max(user.onboardingStep, 2);
  await prisma.user.update({ where: { id: req.user.id }, data: { onboardingStep: step } });
  res.json({ success: true, onboardingStep: step });
});

// ── Step 3: First message / canned response ──
router.post('/first-message', authenticate, async (req, res) => {
  const { cannedResponse } = req.body;
  const step = 3;
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      cannedResponse: cannedResponse || null,
      onboardingStep: step,
    },
  });
  res.json({ success: true, onboardingStep: step });
});

// ── Complete onboarding ──
router.post('/complete', authenticate, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { onboardingStep: 4 },
  });
  res.json({ success: true, onboardingStep: 4 });
});

export default router;
