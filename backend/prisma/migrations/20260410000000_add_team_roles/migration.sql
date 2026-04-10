-- Add UserRole enum, role column on users, inviter_user_id self-relation,
-- InviteStatus enum, and team_invites table.

-- Enums
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Alter users table
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS "inviter_user_id" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_inviter_user_id_fkey"
  FOREIGN KEY ("inviter_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- team_invites table
CREATE TABLE IF NOT EXISTS "team_invites" (
  "id"          TEXT NOT NULL,
  "inviter_id"  TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "role"        "UserRole" NOT NULL DEFAULT 'member',
  "token"       TEXT NOT NULL,
  "status"      "InviteStatus" NOT NULL DEFAULT 'pending',
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMP(3),

  CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_invites_token_key" UNIQUE ("token"),
  CONSTRAINT "team_invites_inviter_id_email_key" UNIQUE ("inviter_id", "email"),
  CONSTRAINT "team_invites_inviter_id_fkey"
    FOREIGN KEY ("inviter_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "team_invites_token_idx" ON "team_invites"("token");
