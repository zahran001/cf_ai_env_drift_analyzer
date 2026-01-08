// src/analysis/redirectUtils.ts
import type { Severity } from "@shared/diff";

export interface RedirectChainDiffResult {
  hopCountChanged: boolean;
  hopCountDiff: number;
  finalHostChanged: boolean;
  severity: Severity;
}

/**
 * Classify redirect chain drift based on hop count and final host changes.
 * Rule B3: Redirect Chain Changed → `REDIRECT_CHAIN_CHANGED`
 * - warn by default
 * - critical if hop count differs by ≥ 2 or final host differs
 */
export function classifyRedirectChainDrift(
  leftChain: string[] = [],
  rightChain: string[] = []
): RedirectChainDiffResult {
  const leftHopCount = leftChain.length;
  const rightHopCount = rightChain.length;
  const hopCountDiff = Math.abs(leftHopCount - rightHopCount);
  const hopCountChanged = hopCountDiff > 0;

  // Extract final host (last element if chain is not empty, else use undefined)
  const leftFinalHost = leftChain.length > 0 ? leftChain[leftChain.length - 1] : undefined;
  const rightFinalHost = rightChain.length > 0 ? rightChain[rightChain.length - 1] : undefined;

  // Normalize to lowercase for comparison
  const leftFinalHostNormalized = leftFinalHost?.toLowerCase();
  const rightFinalHostNormalized = rightFinalHost?.toLowerCase();
  const finalHostChanged = leftFinalHostNormalized !== rightFinalHostNormalized;

  // Determine severity
  let severity: Severity = "info";

  // critical if hop count differs by ≥ 2 OR final host differs
  if (hopCountDiff >= 2 || finalHostChanged) {
    severity = "critical";
  } else if (hopCountChanged) {
    // hop count differs by 1 = warn
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