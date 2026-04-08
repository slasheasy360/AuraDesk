-- AlterTable: add password reset fields (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_expires_at" TIMESTAMP(3);

-- Index so token lookups during reset stay fast
CREATE INDEX IF NOT EXISTS "users_password_reset_token_hash_idx" ON "users"("password_reset_token_hash");
