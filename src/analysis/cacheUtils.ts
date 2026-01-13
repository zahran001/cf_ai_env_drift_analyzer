/**
 * Cache-Control Drift Utilities
 *
 * Responsibility: Parse cache-control headers, detect critical keywords, classify drift severity.
 *
 * Design:
 * 1. parseCacheControl parses cache-control header into normalized directives (as Set)
 * 2. hasCriticalCacheKeyword checks if critical keywords ("no-store", "private") are present
 * 3. classifyCacheControlDrift compares critical keyword presence and returns Severity
 *
 * Reference: Phase-B2.md §4.D1, CACHE_UTILS_DESIGN.md
 */

import type { Severity } from "@shared/diff";
import { CACHE_CRITICAL_KEYWORDS } from "./constants";

/**
 * Parse cache-control header into a set of directive names.
 *
 * Process:
 * 1. If undefined or empty string, return empty set
 * 2. Split on comma to get individual directives
 * 3. For each directive: extract name (before '='), trim, lowercase
 * 4. Filter out empty strings
 * 5. Return deduped set
 *
 * Example:
 * - "no-store, max-age=3600" → Set { "no-store", "max-age" }
 * - "public, no-cache=testing" → Set { "public", "no-cache" }
 * - "NO-STORE" → Set { "no-store" }
 * - "" → Set {}
 * - undefined → Set {}
 *
 * Per RFC 7234, directives are case-insensitive; always lowercase for comparison.
 *
 * @param cacheControl - Raw cache-control header value
 * @returns Set of normalized directive names (lowercase, deduplicated)
 */
export function parseCacheControl(cacheControl?: string): Set<string> {
  if (!cacheControl) return new Set();

  // Split on comma, extract directive names, normalize to lowercase
  const directives = cacheControl
    .split(",")
    .map((directive) => {
      // Extract directive name (before '='), trim whitespace, lowercase
      const name = directive.split("=")[0].trim().toLowerCase();
      return name;
    })
    .filter((name) => name.length > 0); // Filter empty after trim

  return new Set(directives);
}

/**
 * Check if a set of directives contains a critical cache keyword.
 *
 * Critical keywords per Phase-B2.md §4.D1:
 * - "no-store": forbids storage, even in private caches
 * - "private": forbids shared cache storage
 *
 * Logic:
 * 1. Check if either CACHE_CRITICAL_KEYWORDS ("no-store" or "private") is in the set
 * 2. Return true if any critical keyword found
 * 3. Return false if set empty or no critical keywords
 *
 * @param directives - Set of directive names (normalized, lowercase)
 * @returns true if critical keyword present, false otherwise
 */
export function hasCriticalCacheKeyword(directives: Set<string>): boolean {
  // Check for any critical keyword in the set
  for (const keyword of CACHE_CRITICAL_KEYWORDS) {
    if (directives.has(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify cache-control drift severity.
 *
 * Logic per Phase-B2.md §4.D1 with extended semantics:
 * - "critical" if critical keywords appear on only one side
 *   (one has no-store/private, other does not)
 * - "warn" if non-critical directives differ (caching policy changed)
 *   (e.g., max-age=3600 vs max-age=7200, or public vs missing, etc.)
 * - "info" if directive sets are identical
 *
 * Rationale: Non-critical directive changes signal policy shifts that LLM should investigate.
 *
 * Example scenarios:
 * - left: "no-store", right: "public" → critical (left has, right lacks)
 * - left: "public", right: "private" → critical (right has, left lacks)
 * - left: "no-store", right: "no-store" → info (both identical)
 * - left: "public, max-age=3600", right: "public, max-age=7200" → warn (directive changed)
 * - left: "public, max-age=3600", right: undefined → warn (policy removed)
 * - left: undefined, right: "no-store" → critical (right has critical, left lacks)
 * - left: undefined, right: undefined → info (both absent)
 *
 * @param left - Left cache-control header value (raw), or undefined
 * @param right - Right cache-control header value (raw), or undefined
 * @returns Severity: "critical" (critical keyword differs), "warn" (other directive drift), or "info" (no drift)
 */
export function classifyCacheControlDrift(
  left?: string,
  right?: string
): Severity {
  // Parse both sides
  const leftDirectives = parseCacheControl(left);
  const rightDirectives = parseCacheControl(right);

  // Check critical keyword presence on each side
  const leftHasCritical = hasCriticalCacheKeyword(leftDirectives);
  const rightHasCritical = hasCriticalCacheKeyword(rightDirectives);

  // If critical keyword presence differs, it's a critical drift
  if (leftHasCritical !== rightHasCritical) {
    return "critical";
  }

  // If directive sets differ (but no critical keywords), it's a warning drift
  if (!directivesSetsEqual(leftDirectives, rightDirectives)) {
    return "warn";
  }

  // Both sides have identical directives → no drift
  return "info";
}

/**
 * Check if two directive sets are equal (same directives, any order).
 *
 * @param left - Set of directive names (normalized, lowercase)
 * @param right - Set of directive names (normalized, lowercase)
 * @returns true if sets contain identical directives, false otherwise
 */
function directivesSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const directive of left) {
    if (!right.has(directive)) return false;
  }
  return true;
}