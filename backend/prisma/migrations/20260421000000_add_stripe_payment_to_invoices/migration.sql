-- AddColumn: stripe_checkout_id and payment_link to invoices table
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_checkout_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_link" TEXT;

-- CreateIndex: stripe_checkout_id for webhook lookups
CREATE INDEX IF NOT EXISTS "invoices_stripe_checkout_id_idx" ON "invoices"("stripe_checkout_id");
