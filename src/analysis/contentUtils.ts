/**
 * Content Diff Utilities
 *
 * Responsibility: Normalize content-type, classify content-length and body-hash drift.
 *
 * Design:
 * 1. normalizeContentType strips charset and normalizes to lowercase
 * 2. classifyContentTypeDrift compares major types (critical if differ), minor types (warn), or missing (warn)
 * 3. classifyContentLengthDrift uses byte thresholds and status change context
 * 4. classifyBodyHashDrift always returns critical
 *
 * Reference: Phase-B2.md §4.D2–D5, PHASE_B2_DESIGN_DECISIONS.md §content diffing
 */

import type { Severity } from "@shared/diff";
import { CONTENT_THRESHOLDS } from "./constants";

/**
 * Normalize a content-type header by stripping charset and other parameters.
 *
 * Process:
 * 1. If undefined or empty string, return undefined
 * 2. Split on semicolon, take first part
 * 3. Trim whitespace
 * 4. Convert to lowercase
 *
 * Example:
 * - "text/html; charset=utf-8" → "text/html"
 * - "Application/JSON" → "application/json"
 * - "" → undefined
 * - undefined → undefined
 *
 * @param contentType - Raw content-type header value
 * @returns Normalized content-type (major/minor without parameters), or undefined
 */
export function normalizeContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  // Split on semicolon, take first part, trim, and lowercase
  const trimmed = contentType.split(";")[0].trim().toLowerCase();
  // Return undefined if result is empty after trimming
  return trimmed || undefined;
}

/**
 * Classify content-type drift severity.
 *
 * Logic:
 * 1. If normalized values identical → info (no drift)
 * 2. If major type differs (e.g., text/* vs application/*) → critical
 * 3. If same major but minor differs (e.g., text/html vs text/plain) → warn
 * 4. If one is undefined (e.g., missing content-type) → warn
 *
 * Per Phase-B2.md §4.D3:
 * - Major type drift (text vs application) is critical
 * - Minor type drift (html vs plain) is warn
 * - Missing on one side is warn
 *
 * @param left - Left content-type header value (raw)
 * @param right - Right content-type header value (raw)
 * @returns Severity classification: "info" | "warn" | "critical"
 */
export function classifyContentTypeDrift(
  left?: string,
  right?: string
): Severity {
  const normalizedLeft = normalizeContentType(left);
  const normalizedRight = normalizeContentType(right);

  // If both normalize to same value, no drift
  if (normalizedLeft === normalizedRight) return "info";

  // If one is undefined/missing and the other is defined, warn
  if (normalizedLeft === undefined || normalizedRight === undefined) return "warn";

  // Extract major type (before the slash)
  const leftMajor = normalizedLeft.split("/")[0];
  const rightMajor = normalizedRight.split("/")[0];

  // If major types differ (e.g., text vs application), critical
  if (leftMajor !== rightMajor) return "critical";

  // Both present but minor type differs (same major type), warn
  return "warn";
}

/**
 * Classify content-length drift severity.
 *
 * Logic uses byte-threshold rules with status change context:
 * - Delta < 200 bytes → info
 * - Delta 200–2000 bytes → warn
 * - Delta >= 2000 bytes:
 *   - If status unchanged → critical
 *   - If status changed → warn (response may legitimately differ)
 *
 * If either left or right is undefined, return info (insufficient data).
 *
 * Per Phase-B2.md §4.D5 and constants.ts CONTENT_THRESHOLDS.
 *
 * @param left - Left content-length (bytes), or undefined
 * @param right - Right content-length (bytes), or undefined
 * @param statusChanged - Whether HTTP status differs between left and right
 * @returns Severity classification: "info" | "warn" | "critical"
 */
export function classifyContentLengthDrift(
  left?: number,
  right?: number,
  statusChanged: boolean = false
): Severity {
  // If either side missing, no drift to classify
  if (left === undefined || right === undefined) return "info";

  const delta = Math.abs(left - right);

  // Delta < 200B → info
  if (delta < CONTENT_THRESHOLDS.LENGTH_DELTA_INFO_MAX) return "info";

  // Delta < 2000B → warn
  if (delta < CONTENT_THRESHOLDS.LENGTH_DELTA_WARN_MAX) return "warn";

  // Delta >= 2000B → critical if same status, warn if status changed
  return statusChanged ? "warn" : "critical";
}

/**
 * Classify body-hash drift severity.
 *
 * Per Phase-B2.md §4.D4: Body hash drift is **always critical**.
 *
 * Rationale: If the body content differs (as evidenced by hash change),
 * this indicates a fundamental difference in response content that requires attention,
 * regardless of other factors.
 *
 * @returns Always "critical"
 */
export function classifyBodyHashDrift(): Severity {
  return "critical";
}
