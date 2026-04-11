-- CreateTable: ai_settings (tone + automation prompts per user)
CREATE TABLE "ai_settings" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "tones"       JSONB NOT NULL DEFAULT '[]',
  "automations" JSONB NOT NULL DEFAULT '[]',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_settings_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "ai_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: faqs (per-user FAQ knowledge base)
CREATE TABLE "faqs" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "question"   TEXT NOT NULL,
  "answer"     TEXT NOT NULL,
  "category"   TEXT NOT NULL DEFAULT 'general',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "faqs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "faqs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "faqs_user_id_idx" ON "faqs"("user_id");
