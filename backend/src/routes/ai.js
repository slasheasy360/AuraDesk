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
 * 1. Quota check + consume
 * 2. Fetch workspace FAQs (vector search → plain fallback)
 * 3. Build structured prompt
 * 4. Call OpenAI gpt-4o-mini
 * 5. Return reply + usage info
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
    // Team members share the workspace owner's knowledge base.
    const faqOwnerId = req.user.inviterUserId || req.user.id;

    // 2. Fetch FAQs: try vector search first, fall back to all FAQs
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
      // Fallback: fetch all FAQs for this workspace
      console.log(`[AI] Falling back to all FAQs for owner ${faqOwnerId}`);
      const allFaqs = await prisma.faq.findMany({
        where: { userId: faqOwnerId },
        select: { question: true, answer: true, category: true },
        take: 20,
      });

      if (allFaqs.length === 0) {
        await refundAiReply(req.user, { meta: { conversationId, platform } });
        console.warn(`[AI] No FAQs found for owner ${faqOwnerId} (requester: ${req.user.id})`);
        return res.json({
          reply: "I don't have enough data about this question.",
          usage: {
            used: Math.max(0, quota.used - 1),
            limit: quota.limit,
            unlimited: quota.unlimited,
          },
          planWarning: null,
          _debug: { faqOwnerId, requesterId: req.user.id, faqCount: 0 },
        });
      }

      matchedFaqs = allFaqs;
      console.log(`[AI] Using ${allFaqs.length} plain FAQs as context`);
    }

    // 3. Format FAQ context
    const context = matchedFaqs
      .slice(0, 10)
      .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
      .join('\n\n');

    console.log(`[AI] FAQ Context:\n${context}`);
    console.log(`[AI] Final prompt sent to model:\n${buildPrompt(context, prompt)}`);

    // 4. Call OpenAI with the structured template
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

    console.log(`[AI] Response: "${text.slice(0, 120)}" | user: ${req.user.id} | used: ${quota.used}/${quota.unlimited ? '∞' : quota.limit}`);

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
