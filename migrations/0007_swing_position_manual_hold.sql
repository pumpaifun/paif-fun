ALTER TABLE "swing_positions"
ADD COLUMN IF NOT EXISTS "manual_hold" boolean NOT NULL DEFAULT false;