/**
 * Embeddings service — OpenAI text-embedding-3-small + pgvector on Neon.
 *
 * Flow:
 *   createEmbedding(text)          → float[] from OpenAI
 *   storeFaqEmbedding(faqId, text) → upsert vector into faqs.embedding
 *   searchSimilarFaqs(userId, text, topK) → top-K relevant FAQs via cosine similarity
 */

import OpenAI from 'openai';
import prisma from '../utils/prisma.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dims, cheap & fast
const EMBEDDING_DIM = 1536;

/**
 * Call OpenAI Embeddings API and return a float array.
 * The input is the combined question + answer so similarity
 * search matches both the topic AND the answer content.
 */
export async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.replace(/\n/g, ' ').slice(0, 8000), // API limit guard
  });
  return response.data[0].embedding; // float[]
}

/**
 * Generate and store the embedding for a single FAQ.
 * Called after create or update.
 */
export async function storeFaqEmbedding(faqId, question, answer) {
  try {
    const text = `${question} ${answer}`;
    const embedding = await createEmbedding(text);
    // pgvector expects '[0.1, 0.2, ...]' string format
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "faqs"
      SET "embedding" = ${vectorStr}::vector
      WHERE "id" = ${faqId}
    `;
    console.log(`[Embeddings] Stored embedding for FAQ ${faqId}`);
  } catch (err) {
    // Never block FAQ save on embedding failure — log and continue
    console.error(`[Embeddings] Failed to store embedding for FAQ ${faqId}:`, err.message);
  }
}

/**
 * Find the top-K most relevant FAQs for a given query using cosine similarity.
 * Always scoped to userId so one organization never sees another's data.
 *
 * Returns array of { id, question, answer, category, similarity }
 */
export async function searchSimilarFaqs(userId, queryText, topK = 5) {
  try {
    const queryEmbedding = await createEmbedding(queryText);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // <=> is cosine distance (lower = more similar); 1 - distance = similarity
    const results = await prisma.$queryRaw`
      SELECT
        id,
        question,
        answer,
        category,
        1 - ("embedding" <=> ${vectorStr}::vector) AS similarity
      FROM "faqs"
      WHERE "user_id" = ${userId}
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vectorStr}::vector
      LIMIT ${topK}
    `;

    return results;
  } catch (err) {
    console.error('[Embeddings] searchSimilarFaqs failed:', err.message);
    return []; // Fallback: caller will use all FAQs if this returns empty
  }
}

/**
 * Backfill embeddings for all FAQs that don't have one yet.
 * Call once after migration to populate existing FAQ rows.
 * Safe to call multiple times — skips FAQs that already have embeddings.
 */
export async function backfillEmbeddings() {
  const faqs = await prisma.$queryRaw`
    SELECT id, question, answer FROM "faqs" WHERE "embedding" IS NULL
  `;

  if (faqs.length === 0) {
    console.log('[Embeddings] Backfill: no FAQs need embeddings');
    return;
  }

  console.log(`[Embeddings] Backfilling ${faqs.length} FAQ(s)...`);
  for (const faq of faqs) {
    await storeFaqEmbedding(faq.id, faq.question, faq.answer);
  }
  console.log('[Embeddings] Backfill complete');
}
