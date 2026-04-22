-- Create FileProcessingStatus enum
DO $$ BEGIN
  CREATE TYPE "FileProcessingStatus" AS ENUM ('pending', 'processing', 'ready', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Create training_files table
CREATE TABLE IF NOT EXISTS "training_files" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "s3_key" TEXT NOT NULL,
  "status" "FileProcessingStatus" NOT NULL DEFAULT 'pending',
  "error_msg" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploaded_by" TEXT NOT NULL,

  CONSTRAINT "training_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "training_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "training_files_user_id_idx" ON "training_files"("user_id");

-- Create file_chunks table
CREATE TABLE IF NOT EXISTS "file_chunks" (
  "id" TEXT NOT NULL,
  "file_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chunk_idx" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "embedding" vector(1536),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "file_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "training_files"("id") ON DELETE CASCADE
);

-- Create IVFFlat index on embeddings for efficient vector search
CREATE INDEX IF NOT EXISTS "file_chunks_embedding_idx" ON "file_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);

-- Create index on user_id for filtering
CREATE INDEX IF NOT EXISTS "file_chunks_user_id_idx" ON "file_chunks"("user_id");
