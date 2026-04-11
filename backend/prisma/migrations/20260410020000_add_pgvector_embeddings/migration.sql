-- Enable pgvector extension (Neon supports this natively)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to faqs table
-- text-embedding-3-small produces 1536-dimensional vectors
ALTER TABLE "faqs" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- IVFFlat index for fast approximate nearest-neighbor search
-- lists=100 is appropriate for up to ~1M rows
CREATE INDEX IF NOT EXISTS "faqs_embedding_idx"
  ON "faqs" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
