-- AlterTable
ALTER TABLE "messages"
ADD COLUMN "html_content" TEXT,
ADD COLUMN "attachments" JSONB;
