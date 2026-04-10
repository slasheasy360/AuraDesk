import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import {
  assertAndConsumeAiReply,
  refundAiReply,
  PlanLimitError,
} from '../services/planGuard.js';
import prisma from '../utils/prisma.js';

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/ai/generate-reply
 * Body: { conversationId?, prompt, platform? }
 *
 * 1. Quota check + consume
 * 2. Fetch user FAQs + tone settings
 * 3. Build context-aware prompt
 * 4. Call Claude Haiku
 * 5. Return reply + usage info
 *
 * Error shape when quota exhausted (enforce mode):
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

  try {
    // 2. Fetch FAQs + settings + user info
    const [faqs, settings, user] = await Promise.all([
      prisma.faq.findMany({ where: { userId: req.user.id }, take: 30 }),
      prisma.aiSettings.findUnique({ where: { userId: req.user.id } }),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { companyName: true, name: true },
      }),
    ]);

    const tones = Array.isArray(settings?.tones) ? settings.tones : ['friendly'];
    const toneList = tones.length > 0 ? tones.join(', ') : 'friendly';
    const companyName = user?.companyName || 'our company';

    // 3. Build FAQ context
    const faqContext = faqs.length > 0
      ? faqs.map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`).join('\n\n')
      : null;

    const systemPrompt = [
      `You are a helpful customer support AI assistant for ${companyName}.`,
      `Communication tone: ${toneList}.`,
      faqContext ? `\nKnowledge base:\n${faqContext}` : '',
      '\nGuidelines:',
      '- Reply with only the response text, no meta-commentary',
      '- Keep it concise (2-4 sentences)',
      '- Match the specified tone',
      '- If a relevant FAQ exists, base your answer on it',
      '- If no FAQ is relevant, acknowledge warmly and offer to help further',
    ].filter(Boolean).join('\n');

    // 4. Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text?.trim()
      || "I'd be happy to help with that! Could you provide a bit more detail?";

    return res.json({
      reply: text,
      usage: {
        used: quota.used,
        limit: quota.limit,
        unlimited: quota.unlimited,
      },
      planWarning: quota.ok ? null : quota.violation,
    });
  } catch (providerErr) {
    await refundAiReply(req.user, { meta: { conversationId, platform } });
    console.error('[ai/generate-reply] provider error:', providerErr);
    return res.status(502).json({ error: 'AI provider failed. Please try again.' });
  }
});

export default router;
