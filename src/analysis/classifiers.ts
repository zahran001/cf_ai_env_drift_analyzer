// src/analysis/classifiers.ts
import type { Severity } from "@shared/diff";

/**
 * Classify HTTP status code drift by severity per Phase-B2.md §4.B1.
 *
 * Rules:
 * - 2xx vs 4xx/5xx → critical
 * - 2xx vs 5xx → critical
 * - 3xx vs non-3xx → critical
 * - else → warn
 */
export function classifyStatusDrift(left: number, right: number): Severity {
  const leftClass = Math.floor(left / 100);
  const rightClass = Math.floor(right / 100);

  // 2xx vs 4xx/5xx
  if ((leftClass === 2 && (rightClass === 4 || rightClass === 5)) ||
      (rightClass === 2 && (leftClass === 4 || leftClass === 5))) {
    return "critical";
  }

  // 3xx vs non-3xx
  if ((leftClass === 3 && rightClass !== 3) ||
      (rightClass === 3 && leftClass !== 3)) {
    return "critical";
  }

  // All other differences (e.g., 200 vs 201, 404 vs 500, 301 vs 302)
  return "warn";
}