-- AlterTable: add subscription dashboard + grace-period fields (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_subscribed"          BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_period_start"   TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cancel_at_period_end"   BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "grace_period_ends_at"   TIMESTAMP(3);

-- Backfill: any user already on a paid plan with active status counts as subscribed
UPDATE "users"
   SET "is_subscribed" = true
 WHERE "plan" IN ('starter', 'pro', 'elite')
   AND "subscription_status" IN ('active', 'trialing');
