-- AlterTable
ALTER TABLE "connected_accounts"
ADD COLUMN IF NOT EXISTS "gmail_history_id" TEXT,
ADD COLUMN IF NOT EXISTS "gmail_watch_expiration" TIMESTAMP(3);
