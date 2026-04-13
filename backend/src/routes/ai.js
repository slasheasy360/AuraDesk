import { Router } from 'express';
import OpenAI from 'openai';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import {
  assertAndConsumeAiReply,
  refundAiReply,
  PlanLimitError,
} from '../services/planGuard.js';
import prisma from '../utils/prisma.js';
import { searchSimilarFaqs } from '../services/embeddings.js';

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/ai/generate-reply
 * Body: { conversationId?, prompt, platform? }
 *
 * 1. Quota check + consume
 * 2. Fetch user FAQs + tone settings (vector search + plain fallback)
 * 3. Build context-aware prompt
 * 4. Call OpenAI gpt-4o-mini
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
    // Team members store FAQs under the workspace owner's userId.
    // Always resolve to the owner's ID so member + owner share one knowledge base.
    const faqOwnerId = req.user.inviterUserId || req.user.id;

    // 2. Fetch settings + user info + semantic FAQ search in parallel
    const [relevantFaqs, settings, user] = await Promise.all([
      searchSimilarFaqs(faqOwnerId, prompt, 5),
      prisma.aiSettings.findUnique({ where: { userId: faqOwnerId } }),
      prisma.user.findUnique({
        where: { id: faqOwnerId },
        select: { companyName: true, name: true },
      }),
    ]);

    const tones = Array.isArray(settings?.tones) ? settings.tones : ['friendly'];
    const toneList = tones.length > 0 ? tones.join(', ') : 'friendly';
    const companyName = user?.companyName || 'our company';

    // 3. Use vector results if any pass the threshold (lowered to 0.3 for broader coverage).
    //    If none pass — e.g. embeddings not yet generated, or low similarity — fall back to
    //    fetching ALL FAQs for this org so the AI always has something to work with.
    const SIMILARITY_THRESHOLD = 0.3;
    let goodMatches = relevantFaqs.filter(f => Number(f.similarity) >= SIMILARITY_THRESHOLD);

    console.log(`[AI] Vector search: ${relevantFaqs.length} results, ${goodMatches.length} above ${SIMILARITY_THRESHOLD} for user ${req.user.id} (org: ${companyName})`);

    if (goodMatches.length === 0) {
      // Fallback: pull all FAQs directly (covers missing embeddings & low similarity cases)
      console.log(`[AI] Vector search yielded no matches — falling back to all FAQs for owner ${faqOwnerId}`);
      const allFaqs = await prisma.faq.findMany({
        where: { userId: faqOwnerId },
        select: { question: true, answer: true, category: true },
        take: 20,
      });

      if (allFaqs.length === 0) {
        // Truly no FAQ data at all — refund quota and return fallback
        await refundAiReply(req.user, { meta: { conversationId, platform } });
        return res.json({
          reply: "I don't have enough data to answer this question.",
          usage: {
            used: Math.max(0, quota.used - 1),
            limit: quota.limit,
            unlimited: quota.unlimited,
          },
          planWarning: null,
        });
      }

      goodMatches = allFaqs;
    }

    const faqContext = goodMatches
      .slice(0, 10)
      .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
      .join('\n\n');

    const systemPrompt = [
      `You are a customer support AI assistant for ${companyName}.`,
      `Communication tone: ${toneList}.`,
      `\nKnowledge base (your ONLY source of truth):\n${faqContext}`,
      '\nStrict rules:',
      '- Reply with only the response text, no meta-commentary or preamble.',
      '- Keep the reply concise (2–4 sentences max).',
      '- Match the specified tone exactly.',
      '- Base your answer SOLELY on the knowledge base above.',
      '- If the knowledge base does not contain a clear answer, reply exactly: "I don\'t have enough data to answer this question."',
      '- Do NOT use general knowledge, make assumptions, or fabricate information.',
    ].join('\n');

    // 4. Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim()
      || "I don't have enough data to answer this question.";

    // Log AI usage for billing/audit trail
    console.log(`[AI] Reply generated for user ${req.user.id}, org: ${companyName}, platform: ${platform || 'unknown'}, used: ${quota.used}/${quota.unlimited ? '∞' : quota.limit}`);

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
