import { randomUUID } from 'crypto';
import { Router } from 'express';
import OpenAI from 'openai';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import {
  assertAndConsumeAiReply,
  checkAiReplyQuota,
  PlanLimitError,
} from '../services/planGuard.js';
import prisma from '../utils/prisma.js';
import { searchSimilarFaqs } from '../services/embeddings.js';

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * In-memory idempotency store for consume-reply.
 * Maps replyId → { userId, consumedAt } so the same suggestion can only
 * consume one quota unit, even if the user clicks Use Reply then Copy Text.
 * TTL: 24 h. Cleaned up hourly.
 */
const _consumedReplies = new Map();
const _REPLY_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - _REPLY_TTL_MS;
  for (const [id, entry] of _consumedReplies) {
    if (entry.consumedAt < cutoff) _consumedReplies.delete(id);
  }
}, 60 * 60 * 1000);

/**
 * Build the user-facing prompt using the structured template.
 * {context}      → formatted FAQ entries
 * {last_message} → the last inbound customer message
 */
function buildPrompt(context, lastMessage) {
  return `You are an AI assistant for a customer support platform.

Your task is to generate a reply based on the latest user message.

Instructions:
- ALWAYS treat the LAST user message as the actual question.
- Ignore older messages unless needed for context.
- Understand the intent of the question, not just exact wording.
- Match the question with the provided training data (even if wording is different).
- Use ONLY the provided context to generate the answer.
- If multiple relevant entries exist, combine them into a single clear response.
- Keep the response short, helpful, and professional.

Special Rule:
- If the question is general (e.g., "tell me about your business"), use any relevant company-related context to answer.

Fallback Rule:
- If no relevant context is found, respond with:
"I don't have enough data about this question."

---

Context:
${context}

---

Last User Message:
${lastMessage}

---

Answer:`;
}

/**
 * POST /api/ai/generate-reply
 * Body: { conversationId?, prompt, platform? }
 *
 * Generates an AI reply suggestion WITHOUT consuming quota.
 * Quota is only consumed when the user explicitly acts on the suggestion
 * (Use Reply or Copy Text) via POST /api/ai/consume-reply.
 *
 * Returns a unique `replyId` that the frontend passes to consume-reply to
 * prevent double-counting the same suggestion.
 */
router.post('/generate-reply', authenticate, requireActiveSubscription, async (req, res) => {
  const { conversationId, prompt, platform } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }

  // Read-only quota gate — prevents generating if the user is already over limit
  let quota;
  try {
    quota = await checkAiReplyQuota(req.user);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    console.error('[ai/generate-reply] quota check failed:', err);
    return res.status(500).json({ error: 'AI quota check failed' });
  }

  // Unique ID for this suggestion — used by consume-reply for idempotency
  const replyId = randomUUID();

  try {
    // Team members share the workspace owner's knowledge base.
    const faqOwnerId = req.user.inviterUserId || req.user.id;

    // Fetch FAQs: try vector search first, fall back to all FAQs
    const [relevantFaqs, user] = await Promise.all([
      searchSimilarFaqs(faqOwnerId, prompt, 5),
      prisma.user.findUnique({
        where: { id: faqOwnerId },
        select: { companyName: true },
      }),
    ]);

    const companyName = user?.companyName || 'our company';
    const SIMILARITY_THRESHOLD = 0.3;
    let matchedFaqs = relevantFaqs.filter(f => Number(f.similarity) >= SIMILARITY_THRESHOLD);

    console.log(`[AI] Query: "${prompt.slice(0, 80)}" | Vector: ${relevantFaqs.length} results, ${matchedFaqs.length} above ${SIMILARITY_THRESHOLD} | owner: ${faqOwnerId} (${companyName})`);

    if (matchedFaqs.length === 0) {
      console.log(`[AI] Falling back to all FAQs for owner ${faqOwnerId}`);
      const allFaqs = await prisma.faq.findMany({
        where: { userId: faqOwnerId },
        select: { question: true, answer: true, category: true },
        take: 20,
      });

      if (allFaqs.length === 0) {
        console.warn(`[AI] No FAQs found for owner ${faqOwnerId} (requester: ${req.user.id})`);
        // No quota consumed — reply is useless so we don't charge
        return res.json({
          reply: "I don't have enough data about this question.",
          replyId: null, // no replyId = consume-reply won't be called
          usage: { used: quota.used, limit: quota.limit, unlimited: quota.unlimited },
          planWarning: null,
          _debug: { faqOwnerId, requesterId: req.user.id, faqCount: 0 },
        });
      }

      matchedFaqs = allFaqs;
      console.log(`[AI] Using ${allFaqs.length} plain FAQs as context`);
    }

    // Format FAQ context
    const context = matchedFaqs
      .slice(0, 10)
      .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
      .join('\n\n');

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You are a support assistant for ${companyName}. Reply in a helpful and professional tone.`,
        },
        {
          role: 'user',
          content: buildPrompt(context, prompt),
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim()
      || "I don't have enough data about this question.";

    console.log(`[AI] Response: "${text.slice(0, 120)}" | user: ${req.user.id} | quota: ${quota.used ?? '?'}/${quota.unlimited ? '∞' : quota.limit} | replyId: ${replyId}`);

    return res.json({
      reply: text,
      replyId,
      usage: { used: quota.used, limit: quota.limit, unlimited: quota.unlimited },
      planWarning: null,
    });
  } catch (providerErr) {
    // No quota was consumed, so no refund needed
    console.error('[ai/generate-reply] provider error:', providerErr);
    return res.status(502).json({ error: 'AI provider failed. Please try again.' });
  }
});

/**
 * POST /api/ai/consume-reply
 * Body: { replyId, conversationId?, platform? }
 *
 * Atomically increments the AI reply counter for the workspace owner.
 * Idempotent: the same replyId can only consume quota once (tracked in
 * the in-memory _consumedReplies Map with a 24-hour TTL).
 *
 * Called by the frontend when the user clicks "Use Reply" or "Copy Text".
 */
router.post('/consume-reply', authenticate, requireActiveSubscription, async (req, res) => {
  const { replyId, conversationId, platform } = req.body || {};

  // No replyId means the generation returned null (e.g. no FAQ data) — nothing to consume
  if (!replyId) {
    return res.json({ already: false, usage: null });
  }

  // Idempotency check — same replyId already consumed
  const existing = _consumedReplies.get(replyId);
  if (existing) {
    return res.json({ already: true, usage: null });
  }

  let quota;
  try {
    quota = await assertAndConsumeAiReply(req.user, {
      context: 'ai/consume-reply',
      meta: { conversationId, platform },
    });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    console.error('[ai/consume-reply] quota consume failed:', err);
    return res.status(500).json({ error: 'AI quota consume failed' });
  }

  // Mark as consumed so subsequent calls with this replyId are no-ops
  _consumedReplies.set(replyId, { userId: req.user.id, consumedAt: Date.now() });

  console.log(`[AI] consume-reply | user: ${req.user.id} | replyId: ${replyId} | used: ${quota.used}/${quota.unlimited ? '∞' : quota.limit}`);

  return res.json({
    already: false,
    usage: { used: quota.used, limit: quota.limit, unlimited: quota.unlimited },
  });
});

export default router;
