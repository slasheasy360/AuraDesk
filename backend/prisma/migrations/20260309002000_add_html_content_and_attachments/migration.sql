-- AlterTable
ALTER TABLE "messages"
ADD COLUMN IF NOT EXISTS "html_content" TEXT,
ADD COLUMN IF NOT EXISTS "attachments" JSONB;
