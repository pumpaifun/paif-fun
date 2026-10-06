CREATE TABLE IF NOT EXISTS "wallet_write_receipts" (
  "signature" text PRIMARY KEY NOT NULL,
  "purpose" text NOT NULL,
  "wallet_address" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);