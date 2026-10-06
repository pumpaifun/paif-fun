CREATE TABLE IF NOT EXISTS "community_appeals" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "requester_wallet" text NOT NULL,
  "display_name" text NOT NULL,
  "blocked_message" text,
  "category" text NOT NULL,
  "appeal_reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "moderator_note" text,
  "resolved_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_community_appeals_status_created"
  ON "community_appeals" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_community_appeals_requester_created"
  ON "community_appeals" ("requester_wallet", "created_at");