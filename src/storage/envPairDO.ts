import type { SignalEnvelope } from "@shared/signal";
import type { CompareError } from "@shared/api";
import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object for storing environment pair comparisons.
 *
 * STORAGE: DO-local SQLite (via state.storage.sql)
 * SCALE: One instance per pairKey (pair of URLs)
 * RETENTION: Ring buffer keeps last 50 comparisons, auto-deletes oldest
 *
 * IDEMPOTENCY: All methods are retry-safe for Workflow restarts:
 * - createComparison: Probe IDs derived from stable comparisonId
 * - saveProbe: Uses INSERT OR REPLACE with deterministic ID
 * - saveResult/failComparison: UPDATE operations (idempotent)
 *
 * RPC: Enabled in wrangler.toml via new_sqlite_classes; allows direct method calls from Workflow
 */

export interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: CompareError;
}

export class EnvPairDO extends DurableObject {
  private readonly RING_BUFFER_SIZE = 50;
  private schemaInitialized = false;

  /**
   * Constructor receives DurableObjectState and env.
   * ✅ MUST extend DurableObject for RPC support.
   * ✅ Database accessed via this.ctx.storage.sql (DurableObject protected property).
   * ✅ Schema is lazily initialized on first method call.
   *
   * NOTE: With RPC, the constructor isn't called for remote method calls.
   * We access this.ctx.storage.sql directly in methods.
   */
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
  }

  /**
   * Get database instance.
   * Called from every method since constructor isn't called for RPC requests.
   */
  private getDb(): any {
    return this.ctx.storage.sql;
  }

  /**
   * Initialize schema (lazy initialization).
   * Called once before first operation.
   * Uses CREATE TABLE IF NOT EXISTS to be idempotent across DO restarts.
   *
   * Schema: comparisons + probes tables with indexes
   *
   * DESIGN DECISION (2026-01-18):
   * =============================
   * Schema is embedded here (not in migrations/) because:
   *
   * 1. DO-LOCAL SQLITE (not D1):
   *    - Each DO instance has its own isolated SQLite database (state.storage.sql)
   *    - DO-local storage is per-instance, not shared across instances
   *    - Wrangler migrations only apply to D1 (external database service)
   *    - DO-local SQLite has no migration command (this was causing the error)
   *
   * 2. ARCHITECTURE CHOICE (per CLAUDE.md 2.3):
   *    - One DO instance per environment pair (pairKey)
   *    - Each pair has its own isolated schema
   *    - No shared database across pairs
   *
   * 3. LAZY INITIALIZATION:
   *    - Schema created on first DO operation, not on startup
   *    - Flag (schemaInitialized) prevents re-initialization
   *    - CREATE TABLE IF NOT EXISTS ensures idempotency on DO restart
   *    - Negligible cost: ~50-100ms per new pairKey, then cached
   *
   * 4. WHEN TO CHANGE:
   *    - If switching to D1: move schema to migrations/ and use wrangler commands
   *    - If migrating existing data: add version check (PRAGMA user_version)
   *    - For now: MVP uses DO-local SQLite with this approach
   *
   * REFERENCE: migrations/20250117_013000_create_schema.sql (documentation only)
   */
  private async initializeSchema(): Promise<void> {
    if (this.schemaInitialized) {
      return;
    }

    try {
      // Enable foreign keys for this connection
      // ✅ DO SQLite .exec() is SYNCHRONOUS (no await needed)
      this.getDb().exec("PRAGMA foreign_keys = ON");

      // Create comparisons table
      this.getDb().exec(`
        CREATE TABLE IF NOT EXISTS comparisons (
          id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          left_url TEXT NOT NULL,
          right_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          result_json TEXT,
          error TEXT,
          CONSTRAINT status_check CHECK (status IN ('running', 'completed', 'failed'))
        )
      `);

      // Create indexes for comparisons
      this.getDb().exec(`
        CREATE INDEX IF NOT EXISTS idx_comparisons_ts ON comparisons(ts DESC)
      `);
      this.getDb().exec(`
        CREATE INDEX IF NOT EXISTS idx_comparisons_status ON comparisons(status)
      `);

      // Create probes table
      this.getDb().exec(`
        CREATE TABLE IF NOT EXISTS probes (
          id TEXT PRIMARY KEY,
          comparison_id TEXT NOT NULL,
          ts INTEGER NOT NULL,
          side TEXT NOT NULL,
          url TEXT NOT NULL,
          envelope_json TEXT NOT NULL,
          CONSTRAINT side_check CHECK (side IN ('left', 'right')),
          CONSTRAINT unique_probe_side UNIQUE(comparison_id, side),
          FOREIGN KEY(comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
        )
      `);

      // Create indexes for probes
      this.getDb().exec(`
        CREATE INDEX IF NOT EXISTS idx_probes_comparison_id ON probes(comparison_id)
      `);
      this.getDb().exec(`
        CREATE INDEX IF NOT EXISTS idx_probes_side ON probes(side)
      `);

      this.schemaInitialized = true;
    } catch (err) {
      console.error(`[EnvPairDO] Schema initialization failed: ${err}`);
      throw new Error(`Failed to initialize DO schema: ${err}`);
    }
  }

  /**
   * Create a new comparison record with status='running'.
   * Called by Workflow step 2.
   *
   * IDEMPOTENCY: If called twice with same comparisonId:
   * - First call: INSERT creates new row
   * - Retry call: INSERT OR REPLACE updates same row (no duplicate)
   *
   * ✅ Ring buffer cleanup is invoked here.
   */
  async createComparison(
    comparisonId: string,
    leftUrl: string,
    rightUrl: string
  ): Promise<{ comparisonId: string; status: "running" }> {
    await this.initializeSchema();
    const now = Date.now();

    // ✅ CORRECT: Use DO SQLite .exec() API (not D1 .prepare().bind().run())
    this.getDb().exec(
      `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
       VALUES (?, ?, ?, ?, 'running')`,
      comparisonId,
      now,
      leftUrl,
      rightUrl
    );

    // ✅ CRITICAL: Ring buffer cleanup on every new comparison
    await this.retainLatestN(this.RING_BUFFER_SIZE);

    return { comparisonId, status: "running" };
  }

  /**
   * Save probe result (SignalEnvelope).
   * Called by Workflow steps 4 and 6 (left and right probes).
   *
   * IDEMPOTENCY: Probe ID = `${comparisonId}:${side}` (deterministic)
   * - First call: INSERT creates probe record
   * - Retry call: INSERT OR REPLACE updates same probe, no duplicate
   * - UNIQUE(comparison_id, side) constraint enforces single probe per side
   */
  async saveProbe(
    comparisonId: string,
    side: "left" | "right",
    envelope: SignalEnvelope
  ): Promise<void> {
    await this.initializeSchema();
    const probeId = `${comparisonId}:${side}`;
    const now = Date.now();
    // Extract finalUrl from any response (success or error) or use requestedUrl as fallback
    // ProbeSuccess and ProbeResponseError both have response field; ProbeNetworkFailure does not
    const finalUrl =
      "response" in envelope.result
        ? envelope.result.response.finalUrl
        : envelope.requestedUrl;
    const envelopeJson = JSON.stringify(envelope);

    // ✅ CORRECT: Use DO SQLite .exec() API (not D1 .prepare().bind().run())
    this.getDb().exec(
      `INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      probeId,
      comparisonId,
      now,
      side,
      finalUrl,
      envelopeJson
    );
  }

  /**
   * Mark comparison as completed with LLM result.
   * Called by Workflow step 11 on success.
   *
   * IDEMPOTENCY: Calling twice with same result:
   * - First call: UPDATE sets status='completed', result_json
   * - Retry call: UPDATE again (idempotent, no-op if unchanged)
   */
  async saveResult(comparisonId: string, resultJson: unknown): Promise<void> {
    await this.initializeSchema();
    const resultStr = JSON.stringify(resultJson);

    // ✅ CORRECT: Use DO SQLite .exec() API (not D1 .prepare().bind().run())
    this.getDb().exec(
      `UPDATE comparisons
       SET status = 'completed', result_json = ?
       WHERE id = ?`,
      resultStr,
      comparisonId
    );
  }

  /**
   * Mark comparison as failed with structured error.
   * Called by Workflow error handler (step 12) on any failure.
   *
   * Accepts CompareError object (with code + message) per shared/api.ts contract.
   * Stored as JSON text in SQLite; deserialized on read in getComparison().
   *
   * IDEMPOTENCY: Calling twice:
   * - First call: UPDATE sets status='failed', error
   * - Retry call: UPDATE again (last error wins)
   */
  async failComparison(comparisonId: string, error: CompareError): Promise<void> {
    await this.initializeSchema();
    const errorJson = JSON.stringify(error);

    // ✅ CORRECT: Use DO SQLite .exec() API (not D1 .prepare().bind().run())
    this.getDb().exec(
      `UPDATE comparisons
       SET status = 'failed', error = ?
       WHERE id = ?`,
      errorJson,
      comparisonId
    );
  }

  /**
   * Retrieve comparison state for polling.
   * Called by Worker GET /api/compare/:comparisonId handler.
   *
   * ✅ Returns null if comparison not found (Worker returns 404).
   * ✅ Returns terminal state (completed/failed) or running.
   */
  async getComparison(comparisonId: string): Promise<ComparisonState | null> {
    await this.initializeSchema();

    // Stale comparison detection (fail-safe for terminated workflows)
    const STALE_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    // ✅ CORRECT: Use DO SQLite .exec() API which returns Cursor
    // Cursor methods: .one() throws if no row, .all() returns array
    const cursor = this.getDb().exec(
      `SELECT status, ts, result_json, error FROM comparisons WHERE id = ?`,
      comparisonId
    );

    // Try to get first row; if no results, .one() will throw
    let row: { status: string; ts: number; result_json: string | null; error: string | null } | null = null;
    try {
      row = cursor.one() as { status: string; ts: number; result_json: string | null; error: string | null };
    } catch (e) {
      // .one() throws "Expected exactly one result from SQL query, but got no results"
      // when no rows match - this is expected for missing comparisons
      return null;
    }

    // ✅ Return null for missing record (not "running")
    if (!row) {
      return null;
    }

    // ✅ STALE CHECK: If running but older than STALE_MS, mark as failed
    // This handles manual Workflow termination or unexpected crashes.
    // DO owns this decision; it marks stale comparisons as failed.
    if (row.status === "running") {
      const age = now - row.ts;
      if (age > STALE_MS) {
        console.warn(
          `[DO] Comparison ${comparisonId} is stale (${Math.round(age / 1000)}s old), marking as failed`
        );
        const staleError: CompareError = {
          code: "timeout",
          message: "Stale comparison (workflow terminated or lost)",
        };
        // Update the comparison to failed state
        // Clear result_json for consistency (failed comparisons have no result)
        this.getDb().exec(
          `UPDATE comparisons
           SET status = ?, error = ?, result_json = NULL
           WHERE id = ?`,
          "failed",
          JSON.stringify(staleError),
          comparisonId
        );
        // Return the updated state
        return {
          status: "failed",
          error: staleError,
        };
      }
    }

    const state: ComparisonState = { status: row.status as any };

    if (row.result_json) {
      state.result = JSON.parse(row.result_json);
    }
    if (row.error) {
      try {
        state.error = JSON.parse(row.error) as CompareError;
      } catch {
        // Legacy fallback: if error is a plain string (pre-migration data),
        // wrap it in a CompareError object
        state.error = { code: "internal_error", message: row.error };
      }
    }

    return state;
  }

  /**
   * Retrieve recent completed comparisons for LLM context.
   * Called by Workflow step 8 to load historical context.
   *
   * Returns top N (default 10) completed comparisons with results.
   * Used to provide context to LLM for current comparison explanation.
   */
  async getComparisonsForHistory(limit: number = 10): Promise<ComparisonState[]> {
    await this.initializeSchema();

    // ✅ CORRECT: Use DO SQLite .exec().toArray() API (not D1 .prepare().bind().all())
    const cursor = this.getDb().exec(
      `SELECT status, result_json, error
       FROM comparisons
       WHERE status = 'completed'
       ORDER BY ts DESC
       LIMIT ?`,
      limit
    );
    const rows = cursor.toArray();

    return rows.map((row: { status: string; result_json: string | null; error: string | null }) => {
      const state: ComparisonState = { status: row.status as any };
      if (row.result_json) {
        state.result = JSON.parse(row.result_json);
      }
      if (row.error) {
        try {
          state.error = JSON.parse(row.error) as CompareError;
        } catch {
          state.error = { code: "internal_error", message: row.error };
        }
      }
      return state;
    });
  }

  /**
   * Ring buffer retention: synchronous cleanup.
   * Keeps last RING_BUFFER_SIZE (50) comparisons, deletes oldest.
   *
   * CALLED BY: createComparison (after every INSERT)
   *
   * ALGORITHM:
   * 1. Find timestamp of Nth newest comparison (ORDER BY ts DESC LIMIT 1 OFFSET N-1)
   * 2. Find all comparison IDs older than that timestamp
   * 3. Explicitly DELETE probes referencing those comparison IDs
   * 4. DELETE comparisons older than that timestamp
   *
   * IDEMPOTENCY: Explicit cascade (not relying on PRAGMA foreign_keys) ensures
   * orphaned probes never exist, even if PRAGMA is lost on connection restart.
   *
   * EFFICIENCY: Two SQL queries; no background tasks or alarms.
   * QUOTA: Prevents DO storage from exceeding ~100MB limit.
   */
  private async retainLatestN(n: number): Promise<void> {
    // Find timestamp of the Nth newest comparison
    // .one() throws "Expected exactly one result from SQL query, but got no results" if no match
    const nthCursor = this.getDb().exec(
      `SELECT ts FROM comparisons ORDER BY ts DESC LIMIT 1 OFFSET ?`,
      n - 1
    );

    // Try to get the Nth row; if fewer than N comparisons exist, .one() throws
    let nthRow: { ts: number };
    try {
      nthRow = nthCursor.one() as { ts: number };
    } catch (e) {
      // Expected: fewer than N comparisons exist, nothing to delete
      return;
    }

    // Step 1: Find comparison IDs to delete
    const oldCursor = this.getDb().exec(
      `SELECT id FROM comparisons WHERE ts < ? ORDER BY ts ASC`,
      nthRow.ts
    );
    const oldComparisons = oldCursor.toArray() as Array<{ id: string }>;

    if (oldComparisons.length === 0) {
      return;
    }

    // Step 2: Explicitly delete all probes for old comparisons
    // This ensures no orphaned probes remain even if PRAGMA foreign_keys is lost
    const comparisonIds = oldComparisons.map((row) => row.id);
    const placeholders = comparisonIds.map(() => "?").join(",");

    this.getDb().exec(
      `DELETE FROM probes WHERE comparison_id IN (${placeholders})`,
      ...comparisonIds
    );

    // Step 3: Delete old comparisons
    // At this point, all referencing probes are already gone,
    // so CASCADE is not necessary but provides defense-in-depth
    this.getDb().exec(
      `DELETE FROM comparisons WHERE ts < ?`,
      nthRow.ts
    );
  }
}

export default EnvPairDO;
