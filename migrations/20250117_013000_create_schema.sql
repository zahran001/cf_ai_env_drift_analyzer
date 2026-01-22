-- Migration v1: Initial schema for EnvPairDO (2025-01-17 01:30:00)
-- ===================================================================
--
-- IMPORTANT: This file is DOCUMENTATION ONLY for DO-local SQLite
--
-- ACTUAL SCHEMA LOCATION: src/storage/envPairDO.ts:initializeSchema()
--
-- WHY:
-- - This project uses DO-LOCAL SQLITE (not D1)
-- - Each Durable Object instance has its own isolated SQLite database
-- - Schema is lazily initialized on first operation via CREATE TABLE IF NOT EXISTS
-- - Wrangler migrations only apply to D1 (external database service)
-- - wrangler.toml [[migrations]] section is for DO CLASS VERSIONING, not SQL
--
-- WHEN TO USE THIS FILE:
-- 1. Reference: Understanding the schema structure
-- 2. Upgrade: If migrating to D1 in Phase 2+, copy these statements to D1 migrations
-- 3. Review: For documentation purposes
--
-- DO NOT TRY:
-- - npx wrangler migrations apply --local (it won't work, this isn't D1)
-- - Modifying this file to update schema (modify src/storage/envPairDO.ts instead)
--
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
