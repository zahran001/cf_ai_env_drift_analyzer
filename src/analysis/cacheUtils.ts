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
 * Logic per Phase-B2.md §4.D1:
 * - "critical" if critical keywords appear on only one side
 *   (one has no-store/private, other does not)
 * - "info" if critical keyword status matches (both have or both lack)
 *   (different non-critical directives do NOT cause drift)
 * - Undefined/missing treated as no critical keywords
 *
 * Example scenarios:
 * - left: "no-store", right: "public" → critical (left has, right lacks)
 * - left: "public", right: "private" → critical (right has, left lacks)
 * - left: "no-store", right: "no-store" → info (both have)
 * - left: "public", right: "max-age=3600" → info (neither has)
 * - left: undefined, right: "no-store" → critical (right has, left lacks)
 * - left: undefined, right: undefined → info (neither has)
 *
 * @param left - Left cache-control header value (raw), or undefined
 * @param right - Right cache-control header value (raw), or undefined
 * @returns Severity: "critical" if critical keyword presence differs, "info" otherwise
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

  // Both sides have same critical keyword status → no drift
  return "info";
}