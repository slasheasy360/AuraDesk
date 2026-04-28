-- Add currency and stripeSessionId to payments table
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "stripe_session_id" TEXT;

-- Index for fast revenue queries scoped by invoice (and thus by user via join)
CREATE INDEX IF NOT EXISTS "payments_created_at_idx" ON "payments"("created_at");
