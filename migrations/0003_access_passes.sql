CREATE TABLE IF NOT EXISTS "access_passes" (
  "owner_wallet" text PRIMARY KEY NOT NULL,
  "trial_started_at" timestamp,
  "pass_expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "access_pass_purchases" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_wallet" text NOT NULL,
  "pass_id" text NOT NULL,
  "lamports_paid" text NOT NULL,
  "duration_ms" text NOT NULL,
  "tx_signature" text UNIQUE NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_access_pass_purchases_owner"
  ON "access_pass_purchases" ("owner_wallet", "created_at");