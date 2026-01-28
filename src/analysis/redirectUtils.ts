// src/analysis/redirectUtils.ts
import type { Severity } from "@shared/diff";

export interface RedirectChainDiffResult {
  hopCountChanged: boolean;
  hopCountDiff: number;
  finalHostChanged: boolean;
  severity: Severity;
}

/**
 * Extract hostname from a URL string (case-insensitive).
 *
 * Uses the URL constructor to parse the URL and extract the hostname.
 * Returns undefined if URL is invalid or missing.
 *
 * Examples:
 * - "http://example.com" → "example.com"
 * - "https://EXAMPLE.COM:8443" → "example.com" (port stripped, lowercase)
 * - "http://final.com/path?query=1" → "final.com" (path/query stripped)
 * - undefined → undefined
 * - "invalid" → undefined
 *
 * @param url - URL string to parse
 * @returns Hostname (lowercase), or undefined if invalid/missing
 */
function extractHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname?.toLowerCase();
  } catch {
    // Invalid URL
    return undefined;
  }
}

/**
 * Classify redirect chain drift based on hop count and final hostname changes.
 * Rule B3: Redirect Chain Changed → `REDIRECT_CHAIN_CHANGED`
 *
 * MVP Outcome-Focused Severity:
 * - info: No changes
 * - warn: Hop count differs (infrastructure observation, but request succeeds)
 * - critical: Final hostname differs (outcome change, user lands elsewhere)
 *
 * Note: Compares hostnames (not full URLs) to avoid false positives when only
 * scheme or port differs. E.g., http://final.com and https://final.com have
 * the same hostname (final.com) and should NOT trigger finalHostChanged.
 *
 * @param leftChain - Left redirect chain (array of full URLs)
 * @param rightChain - Right redirect chain (array of full URLs)
 * @returns RedirectChainDiffResult with severity classification
 */
export function classifyRedirectChainDrift(
  leftChain: string[] = [],
  rightChain: string[] = []
): RedirectChainDiffResult {
  const leftHopCount = leftChain.length;
  const rightHopCount = rightChain.length;
  const hopCountDiff = Math.abs(leftHopCount - rightHopCount);
  const hopCountChanged = hopCountDiff > 0;

  // Extract hostname from final URL (not full URL string comparison)
  const leftFinalUrl = leftChain.length > 0 ? leftChain[leftChain.length - 1] : undefined;
  const rightFinalUrl = rightChain.length > 0 ? rightChain[rightChain.length - 1] : undefined;

  const leftFinalHostname = extractHostname(leftFinalUrl);
  const rightFinalHostname = extractHostname(rightFinalUrl);

  const finalHostChanged = leftFinalHostname !== rightFinalHostname;

  // Determine severity
  // MVP philosophy: critical only for outcome changes (final host mismatch)
  // Hop count changes are infrastructure observations, not critical
  let severity: Severity = "info";

  // critical only if final hostname differs (outcome change)
  if (finalHostChanged) {
    severity = "critical";
  } else if (hopCountChanged) {
    // Any hop count change = warn (infrastructure observation)
    severity = "warn";
  }

  return {
    hopCountChanged,
    hopCountDiff,
    finalHostChanged,
    severity,
  };
}

/**
 * Extract final host from a redirect chain.
 * Returns the last element if present, otherwise undefined.
 */
export function extractFinalHost(chain: string[] = []): string | undefined {
  return chain.length > 0 ? chain[chain.length - 1] : undefined;
}

/**
 * Compare two redirect chains for structural equality.
 * Used to determine if the redirect chain itself changed (not just hop count/final host).
 */
export function chainsAreEqual(left: string[] = [], right: string[] = []): boolean {
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    // Case-insensitive URL comparison
    if (left[i].toLowerCase() !== right[i].toLowerCase()) {
      return false;
    }
  }

  return true;
}