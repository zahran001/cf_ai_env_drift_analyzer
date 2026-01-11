/**
 * Header Diff Computation Module
 *
 * Responsibility: Normalize HTTP headers, enforce whitelist, compute added/removed/changed diffs.
 *
 * Design:
 * 1. All HTTP header keys are normalized to lowercase
 * 2. Only whitelisted headers are captured:
 *    - Core headers: cache-control, content-type, vary, www-authenticate, location
 *    - Access-Control headers: any header starting with "access-control-"
 * 3. Headers are separated into two groups for independent diffing:
 *    - Core headers (curated list)
 *    - Access-Control headers (flexible, prefix-based)
 * 4. For each group, classify headers as: added, removed, changed, unchanged
 * 5. All keys are sorted alphabetically for determinism
 *
 * Reference: Phase-B2.md §4.C1–C2, PHASE_B2_DESIGN_DECISIONS.md §7
 */

import type { HeaderDiff } from "@shared/diff";
import { changed } from "@shared/diff";
import { HEADER_WHITELIST } from "./constants";

/**
 * Result of computing header diff for both core and access-control groups.
 */
export interface ComputedHeaderDiff {
  /** Diff for core headers (cache-control, content-type, vary, www-authenticate, location) */
  core: HeaderDiff;
  /** Diff for access-control-* headers (flexible matching) */
  accessControl: HeaderDiff;
}

/**
 * Compute the diff between two header sets.
 *
 * Process:
 * 1. Normalize both header sets (lowercase keys, filter by whitelist)
 * 2. Separate each into core headers and access-control headers
 * 3. Compute diff for each group independently
 * 4. Return ComputedHeaderDiff with both groups
 *
 * @param leftHeaders - Headers from left probe (or empty if unavailable)
 * @param rightHeaders - Headers from right probe (or empty if unavailable)
 * @returns ComputedHeaderDiff with core and accessControl diffs
 *
 * Invariants:
 * - All header keys in output are lowercase
 * - Only whitelisted headers appear in output
 * - All key arrays are sorted alphabetically
 * - Deterministic: same input → same output
 */
export function computeHeaderDiff(
  leftHeaders: Record<string, string> = {},
  rightHeaders: Record<string, string> = {}
): ComputedHeaderDiff {
  const normalizedLeft = normalizeHeaders(leftHeaders);
  const normalizedRight = normalizeHeaders(rightHeaders);

  const core = diffHeaderGroups(normalizedLeft.core, normalizedRight.core);
  const accessControl = diffHeaderGroups(
    normalizedLeft.accessControl,
    normalizedRight.accessControl
  );

  return { core, accessControl };
}

/**
 * Normalized headers grouped by category.
 *
 * - core: Only whitelisted core headers (cache-control, content-type, vary, www-authenticate, location)
 * - accessControl: Only headers starting with "access-control-"
 */
interface NormalizedHeaders {
  core: Record<string, string>;
  accessControl: Record<string, string>;
}

/**
 * Normalize headers by:
 * 1. Converting all keys to lowercase
 * 2. Filtering by whitelist (core + access-control-*)
 * 3. Separating into two groups for independent diffing
 *
 * Non-whitelisted headers are silently ignored (per Phase-B2.md §2).
 *
 * @param headers - Raw headers from HTTP response
 * @returns NormalizedHeaders with core and accessControl groups
 */
function normalizeHeaders(headers: Record<string, string>): NormalizedHeaders {
  const core: Record<string, string> = {};
  const accessControl: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Separate into groups based on key pattern
    if (lowerKey.startsWith("access-control-")) {
      // Access-Control headers: any header starting with "access-control-"
      accessControl[lowerKey] = value;
    } else if (HEADER_WHITELIST.has(lowerKey as any)) {
      // Core headers: only whitelisted names
      core[lowerKey] = value;
    }
    // Non-whitelisted headers are silently ignored
  }

  return { core, accessControl };
}

/**
 * Classify headers in a group as added, removed, changed, or unchanged.
 *
 * Logic for each header:
 * - If in right only: "added"
 * - If in left only: "removed"
 * - If in both with same value: "unchanged"
 * - If in both with different value: "changed"
 *
 * All headers are included in the result (as Record entries for determinism).
 *
 * @param left - Left header group (normalized keys, lowercase)
 * @param right - Right header group (normalized keys, lowercase)
 * @returns HeaderDiff with added, removed, changed, unchanged classifications
 */
function diffHeaderGroups(
  left: Record<string, string>,
  right: Record<string, string>
): HeaderDiff {
  const addedRecord: Record<string, string> = {};
  const removedRecord: Record<string, string> = {};
  const changedRecord: Record<string, ReturnType<typeof changed<string>>> = {};
  const unchangedRecord: Record<string, string> = {};

  // Collect all keys from both sides
  const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);

  // Sort keys for deterministic iteration order
  const sortedKeys = Array.from(allKeys).sort();

  // Classify each key
  for (const key of sortedKeys) {
    const leftVal = left[key];
    const rightVal = right[key];

    if (leftVal === undefined) {
      // Present only on right
      addedRecord[key] = rightVal;
    } else if (rightVal === undefined) {
      // Present only on left
      removedRecord[key] = leftVal;
    } else if (leftVal !== rightVal) {
      // Present on both, but values differ
      changedRecord[key] = changed(leftVal, rightVal);
    } else {
      // Present on both, same value
      unchangedRecord[key] = leftVal;
    }
  }

  // Return as HeaderDiff
  return {
    added: addedRecord,
    removed: removedRecord,
    changed: changedRecord,
    unchanged: unchangedRecord,
  };
}

/**
 * Check if a header key is whitelisted (core or access-control-*).
 *
 * Used by validators or classification functions.
 *
 * @param key - Header key to check
 * @returns true if whitelisted
 */
export function isWhitelistedHeader(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return HEADER_WHITELIST.has(lowerKey as any) ||
    lowerKey.startsWith("access-control-");
}

/**
 * Extract headers that differ between two sets.
 *
 * Returns only headers that have changed (added, removed, or value changed).
 *
 * @param leftHeaders - Left headers (raw)
 * @param rightHeaders - Right headers (raw)
 * @returns Array of header keys that differ (sorted, lowercase)
 */
export function getChangedHeaders(
  leftHeaders: Record<string, string> = {},
  rightHeaders: Record<string, string> = {}
): string[] {
  const diff = computeHeaderDiff(leftHeaders, rightHeaders);
  const changedSet = new Set<string>();

  // Add all changed headers from core
  Object.keys(diff.core.added).forEach(h => changedSet.add(h));
  Object.keys(diff.core.removed).forEach(h => changedSet.add(h));
  Object.keys(diff.core.changed).forEach(h => changedSet.add(h));

  // Add all changed headers from access-control
  Object.keys(diff.accessControl.added).forEach(h => changedSet.add(h));
  Object.keys(diff.accessControl.removed).forEach(h => changedSet.add(h));
  Object.keys(diff.accessControl.changed).forEach(h => changedSet.add(h));

  return Array.from(changedSet).sort();
}
