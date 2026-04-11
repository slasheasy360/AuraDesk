-- AlterTable: add AI reply usage tracking columns for plan enforcement.
-- ai_replies_used: count of AI replies consumed in the current billing cycle.
-- ai_replies_cycle_start: anchor timestamp for the current window, used to
--   detect whether a reset is needed without a separate cron job.
-- plan_overrides: optional JSON blob for enterprise deals, shallow-merges on
--   top of PLAN_LIMITS[plan]. NULL on all normal users.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_replies_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_replies_cycle_start" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_overrides" JSONB;
