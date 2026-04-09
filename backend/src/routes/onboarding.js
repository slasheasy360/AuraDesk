import { Router } from 'express';
import multer from 'multer';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { uploadFile, getPresignedUrl } from '../utils/s3.js';

// If companyLogo is an S3 key (not already a URL), resolve it to a fresh presigned URL.
async function resolveLogoUrl(companyLogo) {
  if (!companyLogo || companyLogo.startsWith('http') || companyLogo.startsWith('data:')) return companyLogo;
  try { return await getPresignedUrl(companyLogo, 3600 * 12); } catch { return null; }
}

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
// Single source of truth used by both the frontend route guards and
// the wizard's resume logic. `onboardingCompleted` is the canonical
// flag — `onboardingStep` is just a UI breadcrumb.
router.get('/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      onboardingStep: true,
      onboardingCompleted: true,
      companyName: true,
      companyLogo: true,
      brandColor: true,
      firstName: true,
      lastName: true,
      cannedResponse: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Count active connected accounts so the frontend can show "you have
  // X platforms connected" without an extra round-trip.
  const platformCount = await prisma.connectedAccount.count({
    where: { userId: req.user.id, status: 'active' },
  });

  const companyLogoUrl = await resolveLogoUrl(user.companyLogo);

  res.json({
    ...user,
    companyLogo: companyLogoUrl,
    onboardingCompleted: user.onboardingCompleted,
    hasOrganization: !!user.companyName,
    platformsConnected: platformCount > 0,
    platformCount,
  });
});

// ── Upload logo ──
router.post('/upload-logo', authenticate, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const s3Configured = !!(process.env.S3_UPLOADS_BUCKET && process.env.AWS_ACCESS_KEY_ID);

    if (s3Configured) {
      // S3 path: store key, return presigned URL
      const ext = req.file.originalname ? '.' + req.file.originalname.split('.').pop() : '.png';
      const s3Key = `logos/logo-${req.user.id}-${Date.now()}${ext}`;
      await uploadFile(req.file.buffer, s3Key, req.file.mimetype);
      await prisma.user.update({ where: { id: req.user.id }, data: { companyLogo: s3Key } });
      const url = await getPresignedUrl(s3Key, 3600 * 12);
      return res.json({ url, s3Key });
    }

    // Fallback: store as base64 data URL directly in DB (no S3 required)
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await prisma.user.update({ where: { id: req.user.id }, data: { companyLogo: dataUrl } });
    return res.json({ url: dataUrl, s3Key: null });

  } catch (err) {
    console.error('[upload-logo] error:', err);
    res.status(500).json({ error: 'Logo upload failed. Please try again.' });
  }
});

// ── Branding (organization setup) ──
//
// Creating the organization is the ONLY hard requirement to consider a
// user onboarded. Connecting platforms is optional and can be done later
// from the Connections page. The moment this endpoint succeeds we set
// `onboardingCompleted = true` so the user is permanently routed past
// the wizard from then on.
router.post('/branding', authenticate, async (req, res) => {
  const { firstName, lastName, companyName, brandColor, companyLogo } = req.body;
  if (!firstName || !companyName) {
    return res.status(400).json({ error: 'First name and company name are required' });
  }

  const current = await prisma.user.findUnique({ where: { id: req.user.id } });

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      firstName,
      lastName: lastName || null,
      companyName,
      brandColor: brandColor || null,
      companyLogo: companyLogo || current.companyLogo || null,
      onboardingStep: 4,
      onboardingCompleted: true,
    },
  });

  res.json({
    success: true,
    onboardingStep: user.onboardingStep,
    onboardingCompleted: user.onboardingCompleted,
  });
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
// Idempotent. Used by the legacy "LET'S START" button on the success
// screen. Branding now marks the user as complete on its own, so this
// endpoint is effectively a no-op safety net.
router.post('/complete', authenticate, async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { onboardingStep: 4, onboardingCompleted: true },
  });
  res.json({
    success: true,
    onboardingStep: user.onboardingStep,
    onboardingCompleted: user.onboardingCompleted,
  });
});

// ── Reset onboarding (debug / admin) ──
// Lets a user start the wizard again. Wired only for explicit user action;
// the route guards never trigger this on their own.
router.post('/reset', authenticate, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { onboardingStep: 0, onboardingCompleted: false },
  });
  res.json({ success: true });
});

export default router;
