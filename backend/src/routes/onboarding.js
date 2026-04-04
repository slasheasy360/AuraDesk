import { Router } from 'express';
import multer from 'multer';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { uploadFile, getPresignedUrl } from '../utils/s3.js';

const router = Router();

// Logo upload — store in S3, return pre-signed URL
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

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

// ── Upload logo ──
router.post('/upload-logo', authenticate, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = req.file.originalname ? '.' + req.file.originalname.split('.').pop() : '.png';
  const s3Key = `logos/logo-${req.user.id}-${Date.now()}${ext}`;

  await uploadFile(req.file.buffer, s3Key, req.file.mimetype);

  // Store the S3 key as the logo reference
  await prisma.user.update({
    where: { id: req.user.id },
    data: { companyLogo: s3Key },
  });

  // Return a pre-signed URL for immediate display
  const url = await getPresignedUrl(s3Key);
  res.json({ url, s3Key });
});

// ── Step 1: Branding ──
router.post('/branding', authenticate, async (req, res) => {
  const { firstName, lastName, companyName, brandColor, companyLogo } = req.body;
  if (!firstName || !companyName) {
    return res.status(400).json({ error: 'First name and company name are required' });
  }

  const current = await prisma.user.findUnique({ where: { id: req.user.id } });
  const newStep = Math.max(current.onboardingStep, 1);

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      firstName,
      lastName: lastName || null,
      companyName,
      brandColor: brandColor || null,
      companyLogo: companyLogo || current.companyLogo || null,
      onboardingStep: newStep,
    },
  });

  res.json({ success: true, onboardingStep: user.onboardingStep });
});

// ── Step 2: Platform connection ── (marks step as visited)
router.post('/platforms', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const step = Math.max(user.onboardingStep, 2);
  await prisma.user.update({ where: { id: req.user.id }, data: { onboardingStep: step } });
  res.json({ success: true, onboardingStep: step });
});

// ── Step 3: First message / canned response ──
router.post('/first-message', authenticate, async (req, res) => {
  const { cannedResponse } = req.body;
  const current = await prisma.user.findUnique({ where: { id: req.user.id } });
  const step = Math.max(current.onboardingStep, 3);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { cannedResponse: cannedResponse || null, onboardingStep: step },
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
