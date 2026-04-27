-- ── Stripe Connect: connected account info per workspace owner ────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "stripe_connect_account_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "stripe_connect_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stripe_connect_account_name"    TEXT;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_stripe_connect_account_id_key"
    UNIQUE ("stripe_connect_account_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Invoices: track checkout session expiry for reuse logic ───────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "stripe_session_expires_at" TIMESTAMP(3);

-- ── Payments: provider + Stripe payment-intent id + refund tracking ───────
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "provider"               TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" TEXT,
  ADD COLUMN IF NOT EXISTS "refunded_at"            TIMESTAMP(3);

-- Partial unique index: allows multiple NULLs but no duplicate non-null values
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripe_payment_intent_id_key"
  ON "payments" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" IS NOT NULL;
