import { Router } from 'express';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import {
  assertAndConsumeAiReply,
  refundAiReply,
  PlanLimitError,
} from '../services/planGuard.js';

const router = Router();

/**
 * POST /api/ai/generate-reply
 *
 * Body: { conversationId?, prompt, platform? }
 *
 * Phase 1 scaffold. Quota is tracked and refunded on failure, but the
 * actual AI provider integration is a TODO — this returns a stub reply
 * so the frontend can wire up the button + counter UI now without
 * waiting for Claude API wiring. Replace the stub block with a real
 * call to your AI provider when you're ready.
 *
 * Error shape when quota is exhausted (enforce mode only):
 *   403 { error: 'AI_LIMIT', message, meta: { used, limit, upgradeTo, ... } }
 */
router.post('/generate-reply', authenticate, requireActiveSubscription, async (req, res) => {
  const { conversationId, prompt, platform } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }

  // 1. Quota check + atomic consume
  let quota;
  try {
    quota = await assertAndConsumeAiReply(req.user, {
      context: 'ai/generate-reply',
      meta: { conversationId, platform },
    });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    console.error('[ai/generate-reply] quota check failed:', err);
    return res.status(500).json({ error: 'AI quota check failed' });
  }

  // In log-only mode, `quota.ok` may be false but we STILL proceed so the
  // user isn't impacted. `quota.violation` is already logged by planGuard.
  try {
    // ─── TODO: replace with real AI provider call ────────────────────
    // Example shape:
    //   const reply = await anthropic.messages.create({
    //     model: 'claude-sonnet-4-6',
    //     max_tokens: 512,
    //     messages: [{ role: 'user', content: prompt }],
    //   });
    //   const text = reply.content[0].text;
    const text = `(stub AI reply) ${prompt.slice(0, 200)}`;
    // ────────────────────────────────────────────────────────────────

    return res.json({
      reply: text,
      usage: {
        used: quota.used,
        limit: quota.limit,
        unlimited: quota.unlimited,
      },
      // Surface the log-only violation to the frontend so it can show a
      // "you would have been blocked" soft warning if you want to test
      // the UX before flipping enforcement on.
      planWarning: quota.ok ? null : quota.violation,
    });
  } catch (providerErr) {
    // Refund the quota so the user isn't charged for a failed reply.
    await refundAiReply(req.user, { meta: { conversationId, platform } });
    console.error('[ai/generate-reply] provider error:', providerErr);
    return res.status(502).json({ error: 'AI provider failed. Please try again.' });
  }
});

export default router;
