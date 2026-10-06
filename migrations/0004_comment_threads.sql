ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "parent_comment_id" varchar;

CREATE INDEX IF NOT EXISTS "idx_comments_parent_created"
  ON "comments" ("parent_comment_id", "created_at");