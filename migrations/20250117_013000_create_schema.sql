-- Migration v1: Initial schema for EnvPairDO (2025-01-17 01:30:00)
-- ===================================================================
-- Stores comparison metadata and probe data.
-- Ring buffer retention keeps last 50 comparisons per DO instance.

-- Enable foreign key constraints for this connection
PRAGMA foreign_keys = ON;

CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  left_url TEXT NOT NULL,
  right_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result_json TEXT,
  error TEXT,

  CONSTRAINT status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX idx_comparisons_ts ON comparisons(ts DESC);
CREATE INDEX idx_comparisons_status ON comparisons(status);

CREATE TABLE probes (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  side TEXT NOT NULL,
  url TEXT NOT NULL,
  envelope_json TEXT NOT NULL,

  CONSTRAINT side_check CHECK (side IN ('left', 'right')),
  CONSTRAINT unique_probe_side UNIQUE(comparison_id, side),
  FOREIGN KEY(comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
);

CREATE INDEX idx_probes_comparison_id ON probes(comparison_id);
CREATE INDEX idx_probes_side ON probes(side);
