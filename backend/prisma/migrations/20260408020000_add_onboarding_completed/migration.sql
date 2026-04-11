-- AlterTable: add canonical onboarding-completion flag.
-- This is the single source of truth for "has the user finished setup?".
-- The legacy `onboarding_step` int stays as a UI breadcrumb but is no
-- longer used for routing decisions on the frontend.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: anyone who already reached step >= 4 in the old flow is
-- considered fully onboarded and should never see the wizard again.
UPDATE "users" SET "onboarding_completed" = TRUE WHERE "onboarding_step" >= 4;
