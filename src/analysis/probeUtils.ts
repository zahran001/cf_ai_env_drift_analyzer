// src/analysis/probeUtils.ts
import type { SignalEnvelope, ProbeOutcomeDiff } from "@shared/diff";

export function compileProbeOutcomeDiff(
  left: SignalEnvelope,
  right: SignalEnvelope
): ProbeOutcomeDiff {
  const leftOk = left.result.ok;
  const rightOk = right.result.ok;
  const leftHasResponse = "response" in left.result;
  const rightHasResponse = "response" in right.result;

  return {
    leftOk,
    rightOk,
    leftErrorCode: !leftOk ? (left.result as any).error?.code : undefined,
    rightErrorCode: !rightOk ? (right.result as any).error?.code : undefined,
    outcomeChanged: leftOk !== rightOk,
    responsePresent: leftHasResponse && rightHasResponse,
  };
}

/**
 * Determine if a probe side is a network failure (no HTTP response).
 *
 * A network failure occurs when:
 * - The probe result has ok=false AND
 * - There is no HTTP response (only an error object)
 *
 * This is distinct from HTTP error responses (4xx/5xx), which have ok=false
 * but DO have an HTTP response with a status code.
 *
 * @param probe - ProbeOutcomeDiff with both sides' outcomes
 * @param side - 'left' or 'right'
 * @returns true if the specified side is a network failure (no response)
 *
 * @example
 * // Network failure case (DNS error, timeout, etc.)
 * const probe = { leftOk: false, leftErrorCode: 'dns_error', responsePresent: false };
 * isNetworkFailure(probe, 'left') // → true
 *
 * // HTTP error case (4xx/5xx status code)
 * const probe = { rightOk: false, rightErrorCode: undefined, responsePresent: true };
 * isNetworkFailure(probe, 'right') // → false
 */
export function isNetworkFailure(probe: ProbeOutcomeDiff, side: "left" | "right"): boolean {
  if (side === "left") {
    // Network failure: has error code AND no response (responsePresent is false or undefined)
    return probe.leftErrorCode !== undefined && !probe.responsePresent;
  } else {
    return probe.rightErrorCode !== undefined && !probe.responsePresent;
  }
}
