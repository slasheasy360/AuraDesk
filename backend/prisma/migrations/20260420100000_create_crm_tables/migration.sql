-- CreateEnum: LeadStatus (idempotent)
DO $$ BEGIN
  CREATE TYPE "LeadStatus" AS ENUM ('New', 'Warm', 'Won', 'Lost');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: PaymentType (idempotent)
DO $$ BEGIN
  CREATE TYPE "PaymentType" AS ENUM ('Deposit', 'Partial', 'Full');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: InvoiceStatus (idempotent — also handled by prior migration, but safe to repeat)
DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: leads
CREATE TABLE IF NOT EXISTS "leads" (
    "id"                TEXT        NOT NULL,
    "user_id"           TEXT        NOT NULL,
    "name"              TEXT        NOT NULL,
    "platform"          TEXT,
    "last_contacted_at" TIMESTAMP(3),
    "last_action"       TEXT,
    "status"            "LeadStatus" NOT NULL DEFAULT 'New',
    "conversation_id"   TEXT,
    "email"             TEXT,
    "phone"             TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable: invoices
CREATE TABLE IF NOT EXISTS "invoices" (
    "id"              TEXT           NOT NULL,
    "user_id"         TEXT           NOT NULL,
    "lead_id"         TEXT,
    "invoice_number"  TEXT           NOT NULL,
    "public_slug"     TEXT           NOT NULL,
    "client_name"     TEXT           NOT NULL,
    "client_email"    TEXT,
    "client_phone"    TEXT,
    "billing_address" TEXT,
    "issue_date"      TIMESTAMP(3)   NOT NULL,
    "due_date"        TIMESTAMP(3)   NOT NULL,
    "note"            TEXT,
    "currency"        TEXT           NOT NULL DEFAULT 'USD',
    "tax_rate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_amount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status"          "InvoiceStatus" NOT NULL DEFAULT 'Draft',
    "created_at"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable: invoice_items
CREATE TABLE IF NOT EXISTS "invoice_items" (
    "id"          TEXT             NOT NULL,
    "invoice_id"  TEXT             NOT NULL,
    "description" TEXT             NOT NULL,
    "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit_price"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position"    INTEGER          NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payments
CREATE TABLE IF NOT EXISTS "payments" (
    "id"         TEXT          NOT NULL,
    "invoice_id" TEXT          NOT NULL,
    "amount"     DOUBLE PRECISION NOT NULL,
    "date"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type"       "PaymentType" NOT NULL DEFAULT 'Partial',
    "note"       TEXT,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "leads_conversation_id_key" ON "leads"("conversation_id");
CREATE INDEX IF NOT EXISTS "leads_user_id_idx" ON "leads"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_public_slug_key" ON "invoices"("public_slug");
CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices"("user_id");
CREATE INDEX IF NOT EXISTS "invoices_lead_id_idx" ON "invoices"("lead_id");
CREATE INDEX IF NOT EXISTS "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");
CREATE INDEX IF NOT EXISTS "payments_invoice_id_idx" ON "payments"("invoice_id");

-- AddForeignKey: leads.user_id → users.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: leads.conversation_id → conversations.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: invoices.user_id → users.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: invoices.lead_id → leads.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: invoice_items.invoice_id → invoices.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: payments.invoice_id → invoices.id (idempotent)
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
