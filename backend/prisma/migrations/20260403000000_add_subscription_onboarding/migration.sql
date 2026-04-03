-- CreateEnum (idempotent)
DO $$ BEGIN CREATE TYPE "PlanType" AS ENUM ('trial', 'starter', 'pro', 'elite', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SubStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: add columns (idempotent — skip if already exists)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" "PlanType" NOT NULL DEFAULT 'trial';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" "SubStatus" NOT NULL DEFAULT 'trialing';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_cycle" "BillingCycle";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_step" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_logo" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_color" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "canned_response" TEXT;

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer_id_key" ON "users"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_subscription_id_key" ON "users"("stripe_subscription_id");

-- Set trial for existing users
UPDATE "users" SET "trial_ends_at" = NOW() + INTERVAL '14 days' WHERE "trial_ends_at" IS NULL;

-- Message dedup index
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_platform_message" ON "messages"("conversation_id", "platform_message_id");
