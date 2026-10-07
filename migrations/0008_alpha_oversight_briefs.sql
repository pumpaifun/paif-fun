CREATE TABLE IF NOT EXISTS alpha_oversight_briefs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  advisory_only boolean NOT NULL DEFAULT true CHECK (advisory_only = true),
  engine text NOT NULL CHECK (engine = 'rules-based-fallback'),
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  recommendation text NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alpha_briefs_owner ON alpha_oversight_briefs (owner_wallet, generated_at);
CREATE INDEX IF NOT EXISTS idx_swing_paper_closed ON swing_positions (closed_at)
  WHERE mode = 'paper' AND status = 'closed';
