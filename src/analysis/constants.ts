/**
 * Centralized constants for Phase B2 analysis.
 * All thresholds and keywords referenced in Phase-B2.md §3
 */

// Timing thresholds (milliseconds)
export const TIMING_CONSTANTS = {
  MIN_TIMING_LEFT_MS: 50,      // Min slower duration to trigger
  ABS_DELTA_WARN_MS: 300,      // Absolute delta for "warn"
  ABS_DELTA_CRIT_MS: 1000,     // Absolute delta for "critical"
  RATIO_WARN: 1.5,              // Ratio for "warn"
  RATIO_CRIT: 2.5,              // Ratio for "critical"
} as const;

// Content thresholds (bytes)
export const CONTENT_THRESHOLDS = {
  LENGTH_DELTA_INFO_MAX: 200,    // < 200B = info
  LENGTH_DELTA_WARN_MAX: 2000,   // < 2000B = warn
  // >= 2000B = critical (if same status) or warn (if status changed)
} as const;

// Cache keywords (critical if differ)
export const CACHE_CRITICAL_KEYWORDS = ["no-store", "private"] as const;

// Header whitelist (only these captured)
export const HEADER_WHITELIST = new Set([
  "cache-control",
  "content-type",
  "vary",
  "www-authenticate",
  "location",
  // access-control-* handled separately
] as const);

// Severity ordering for sorting
export const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 } as const;

// Evidence vocabulary (used by validators.ts)
export const VALID_EVIDENCE_KEYS = {
  probe: ["left", "right"],
  status: [],
  finalUrl: ["scheme", "host", "path", "query", "finalUrl"],
  redirects: ["hopCount", "chain", "finalHost"],
  headers: [
    // Any lowercase header name
  ],
  content: ["content-type", "content-length", "body-hash"],
  timing: ["duration_ms"],
  cf: ["colo", "asn", "country"],
} as const;
