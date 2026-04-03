-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('trial', 'starter', 'pro', 'elite', 'expired');
CREATE TYPE "SubStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired');
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');

-- AlterTable: add subscription, trial, and onboarding columns to users
ALTER TABLE "users" ADD COLUMN "plan" "PlanType" NOT NULL DEFAULT 'trial';
ALTER TABLE "users" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "subscription_status" "SubStatus" NOT NULL DEFAULT 'trialing';
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" TEXT;
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" TEXT;
ALTER TABLE "users" ADD COLUMN "current_period_end" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "billing_cycle" "BillingCycle";
ALTER TABLE "users" ADD COLUMN "onboarding_step" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "company_name" TEXT;
ALTER TABLE "users" ADD COLUMN "company_logo" TEXT;
ALTER TABLE "users" ADD COLUMN "brand_color" TEXT;
ALTER TABLE "users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN "last_name" TEXT;
ALTER TABLE "users" ADD COLUMN "canned_response" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");
CREATE UNIQUE INDEX "users_stripe_subscription_id_key" ON "users"("stripe_subscription_id");

-- Set trial for existing users (14 days from now)
UPDATE "users" SET "trial_ends_at" = NOW() + INTERVAL '14 days' WHERE "trial_ends_at" IS NULL;

-- Also add the message dedup index if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_platform_message" ON "messages"("conversation_id", "platform_message_id");
