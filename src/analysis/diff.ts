/**
 * Diff Module - Wrapper to compute EnvDiff from two SignalEnvelopes
 *
 * Coordinates the comparison of two probes:
 * 1. Normalizes SignalEnvelopes to EnvDiff structure
 * 2. Classifies findings using Phase-B2 rules
 * 3. Returns deterministic, immutable result
 *
 * Per CLAUDE.md 3.2:
 * - Pure function: same inputs → identical output every time
 * - No randomness, no timestamps in output
 * - No AI/LLM calls
 * - Output conforms to EnvDiff schema exactly
 */

import type { SignalEnvelope, ProbeSuccess } from "@shared/signal";
import type { EnvDiff, Change } from "@shared/diff";
import { DIFF_SCHEMA_VERSION, computeMaxSeverity, unchanged, changed } from "@shared/diff";
import { classify } from "./classify";

/**
 * Compute diff from two SignalEnvelopes.
 *
 * This function:
 * - Takes two normalized probe results (SignalEnvelopes)
 * - Builds an EnvDiff structure comparing them
 * - Applies all Phase-B2 classification rules
 * - Returns deterministic findings array
 *
 * @param leftEnvelope - Left side probe result (or failure)
 * @param rightEnvelope - Right side probe result (or failure)
 * @returns EnvDiff with deterministic findings
 */
export function computeDiff(leftEnvelope: SignalEnvelope, rightEnvelope: SignalEnvelope): EnvDiff {
  // Extract probe outcomes
  const leftOk = leftEnvelope.result.ok;
  const rightOk = rightEnvelope.result.ok;

  // Build probe outcome diff
  const probeOutcomeDiff = {
    leftOk,
    rightOk,
    leftErrorCode: !leftOk && "error" in leftEnvelope.result ? leftEnvelope.result.error.code : undefined,
    rightErrorCode: !rightOk && "error" in rightEnvelope.result ? rightEnvelope.result.error.code : undefined,
    outcomeChanged: leftOk !== rightOk,
  };

  // If either probe failed, return early with minimal diff
  if (!leftOk || !rightOk) {
    const findings = classify({
      schemaVersion: DIFF_SCHEMA_VERSION,
      comparisonId: leftEnvelope.comparisonId,
      leftProbeId: leftEnvelope.probeId,
      rightProbeId: rightEnvelope.probeId,
      probe: probeOutcomeDiff,
      findings: [],
      maxSeverity: "info",
    });

    return {
      schemaVersion: DIFF_SCHEMA_VERSION,
      comparisonId: leftEnvelope.comparisonId,
      leftProbeId: leftEnvelope.probeId,
      rightProbeId: rightEnvelope.probeId,
      probe: probeOutcomeDiff,
      findings,
      maxSeverity: computeMaxSeverity(findings),
    };
  }

  // Both probes succeeded; extract responses
  const leftResponse = (leftEnvelope.result as ProbeSuccess).response;
  const rightResponse = (rightEnvelope.result as ProbeSuccess).response;

  // Build status diff
  const statusDiff: Change<number> =
    leftResponse.status === rightResponse.status
      ? unchanged(leftResponse.status)
      : changed(leftResponse.status, rightResponse.status);

  // Build final URL diff
  const finalUrlDiff: Change<string> =
    leftResponse.finalUrl === rightResponse.finalUrl
      ? unchanged(leftResponse.finalUrl)
      : changed(leftResponse.finalUrl, rightResponse.finalUrl);

  // Build partial EnvDiff (omit findings initially)
  const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    comparisonId: leftEnvelope.comparisonId,
    leftProbeId: leftEnvelope.probeId,
    rightProbeId: rightEnvelope.probeId,
    probe: probeOutcomeDiff,
    status: statusDiff,
    finalUrl: finalUrlDiff,
  };

  // Classify and generate findings
  const findings = classify(partialEnvDiff as EnvDiff);
  const maxSeverity = computeMaxSeverity(findings);

  // Return complete diff with findings
  return {
    ...partialEnvDiff,
    findings,
    maxSeverity,
  };
}
