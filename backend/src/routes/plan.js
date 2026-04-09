import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUsageSnapshot, getEnforcementMode } from '../services/planGuard.js';

const router = Router();

/**
 * GET /api/plan/usage
 * Returns the full plan + limits + live usage snapshot for the
 * current user's workspace. Used by the frontend to render
 * connection counters, seat counters, AI quota bars, etc.
 */
router.get('/usage', authenticate, async (req, res) => {
  try {
    const snapshot = await getUsageSnapshot(req.user);
    if (!snapshot) return res.status(404).json({ error: 'No plan data' });
    res.json({
      ...snapshot,
      enforcementMode: getEnforcementMode(), // 'log' | 'enforce' | 'off'
    });
  } catch (err) {
    console.error('[plan/usage] failed:', err);
    res.status(500).json({ error: 'Failed to load plan usage' });
  }
});

export default router;
