-- Defensive: create the full enum if it doesn't exist yet (handles DBs where the
-- init migration was marked applied without actually running), otherwise just add
-- the new Cancelled value. The third case (already has Cancelled) is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'InvoiceStatus'
  ) THEN
    -- Type was never created; build it from scratch with all current values
    CREATE TYPE "InvoiceStatus" AS ENUM ('Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled');
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'InvoiceStatus' AND e.enumlabel = 'Cancelled'
  ) THEN
    -- Type exists but is missing Cancelled
    ALTER TYPE "InvoiceStatus" ADD VALUE 'Cancelled';
  END IF;
END
$$;
