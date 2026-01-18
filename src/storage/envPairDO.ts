import type { SignalEnvelope } from "../../shared/signal";

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
 * RPC: Enabled in wrangler.toml; allows direct method calls from Workflow
 */

interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private db: any; // state.storage.sql type
  private readonly RING_BUFFER_SIZE = 50;

  /**
   * Constructor receives DurableObjectState only.
   * ✅ DO does NOT receive env parameter.
   * ✅ Database accessed via state.storage.sql (DO-local SQLite).
   */
  constructor(state: DurableObjectState) {
    this.db = state.storage.sql;
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
    const now = Date.now();

    // ✅ CORRECT: Use state.storage.sql API
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
         VALUES (?, ?, ?, ?, 'running')`
      )
      .bind(comparisonId, now, leftUrl, rightUrl)
      .run();

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
    const probeId = `${comparisonId}:${side}`;
    const now = Date.now();
    // Extract finalUrl from successful result or use requestedUrl as fallback
    const finalUrl =
      envelope.result.ok && envelope.result.response
        ? envelope.result.response.finalUrl
        : envelope.requestedUrl;
    const envelopeJson = JSON.stringify(envelope);

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(probeId, comparisonId, now, side, finalUrl, envelopeJson)
      .run();
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
    const resultStr = JSON.stringify(resultJson);

    await this.db
      .prepare(
        `UPDATE comparisons
         SET status = 'completed', result_json = ?
         WHERE id = ?`
      )
      .bind(resultStr, comparisonId)
      .run();
  }

  /**
   * Mark comparison as failed with error message.
   * Called by Workflow error handler (step 12) on any failure.
   *
   * IDEMPOTENCY: Calling twice:
   * - First call: UPDATE sets status='failed', error
   * - Retry call: UPDATE again (last error wins)
   */
  async failComparison(comparisonId: string, error: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE comparisons
         SET status = 'failed', error = ?
         WHERE id = ?`
      )
      .bind(error, comparisonId)
      .run();
  }

  /**
   * Retrieve comparison state for polling.
   * Called by Worker GET /api/compare/:comparisonId handler.
   *
   * ✅ Returns null if comparison not found (Worker returns 404).
   * ✅ Returns terminal state (completed/failed) or running.
   */
  async getComparison(comparisonId: string): Promise<ComparisonState | null> {
    const row = (await this.db
      .prepare(
        `SELECT status, result_json, error
         FROM comparisons
         WHERE id = ?`
      )
      .bind(comparisonId)
      .first()) as { status: string; result_json: string | null; error: string | null } | undefined;

    // ✅ Return null for missing record (not "running")
    if (!row) {
      return null;
    }

    const state: ComparisonState = { status: row.status as any };

    if (row.result_json) {
      state.result = JSON.parse(row.result_json);
    }
    if (row.error) {
      state.error = row.error;
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
    const rows = (await this.db
      .prepare(
        `SELECT status, result_json, error
         FROM comparisons
         WHERE status = 'completed'
         ORDER BY ts DESC
         LIMIT ?`
      )
      .bind(limit)
      .all()) as { results: Array<{ status: string; result_json: string | null; error: string | null }> };

    return rows.results.map((row: { status: string; result_json: string | null; error: string | null }) => {
      const state: ComparisonState = { status: row.status as any };
      if (row.result_json) {
        state.result = JSON.parse(row.result_json);
      }
      if (row.error) {
        state.error = row.error;
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
    const nthRow = (await this.db
      .prepare(
        `SELECT ts FROM comparisons
         ORDER BY ts DESC
         LIMIT 1 OFFSET ?`
      )
      .bind(n - 1)
      .first()) as { ts: number } | undefined;

    // If fewer than N comparisons exist, nothing to delete
    if (!nthRow) {
      return;
    }

    // Step 1: Find comparison IDs to delete
    const oldComparisons = (await this.db
      .prepare(
        `SELECT id FROM comparisons WHERE ts < ?
         ORDER BY ts ASC`
      )
      .bind(nthRow.ts)
      .all()) as { results: Array<{ id: string }> };

    if (oldComparisons.results.length === 0) {
      return;
    }

    // Step 2: Explicitly delete all probes for old comparisons
    // This ensures no orphaned probes remain even if PRAGMA foreign_keys is lost
    const comparisonIds = oldComparisons.results.map((row) => row.id);
    const placeholders = comparisonIds.map(() => "?").join(",");

    await this.db
      .prepare(`DELETE FROM probes WHERE comparison_id IN (${placeholders})`)
      .bind(...comparisonIds)
      .run();

    // Step 3: Delete old comparisons
    // At this point, all referencing probes are already gone,
    // so CASCADE is not necessary but provides defense-in-depth
    await this.db
      .prepare(`DELETE FROM comparisons WHERE ts < ?`)
      .bind(nthRow.ts)
      .run();
  }
}

export default EnvPairDO;
