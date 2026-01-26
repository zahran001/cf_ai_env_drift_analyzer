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
import type { FrozenSignalEnvelope, ProbeSuccess, ProbeResponseError } from "@shared/signal";
import type { EnvDiff, Change, RedirectDiff } from "@shared/diff";
import { DIFF_SCHEMA_VERSION, computeMaxSeverity, unchanged, changed } from "@shared/diff";
import { classify } from "./classify";
import { compileProbeOutcomeDiff } from "./probeUtils";
import { chainsAreEqual } from "./redirectUtils";

/**
 * Compute diff from two SignalEnvelopes.
 *
 * This function:
 * - Takes two normalized probe results (SignalEnvelopes)
 * - Builds an EnvDiff structure comparing them
 * - Applies all Phase-B2 classification rules
 * - Returns deterministic findings array
 *
 * Accepts FrozenSignalEnvelope (JSON-serialized versions from Workflow step.do())
 * which is structurally compatible with SignalEnvelope.
 *
 * @param leftEnvelope - Left side probe result (or failure), potentially from Workflow serialization
 * @param rightEnvelope - Right side probe result (or failure), potentially from Workflow serialization
 * @returns EnvDiff with deterministic findings
 */
export function computeDiff(leftEnvelope: FrozenSignalEnvelope, rightEnvelope: FrozenSignalEnvelope): EnvDiff {
  // Compile probe outcome diff using shared utility
  const probeOutcomeDiff = compileProbeOutcomeDiff(leftEnvelope as any, rightEnvelope as any);

  // If either probe encountered a network failure (no response), return early with minimal diff
  if (!probeOutcomeDiff.responsePresent) {
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

  // Both probes completed (have response field); extract responses
  // This includes both ProbeSuccess (ok=true) and ProbeResponseError (ok=false)
  // TypeScript now knows from the check above that both have response fields
  const leftResponse = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).response;
  const rightResponse = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).response;

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

  // Build redirect diff
  const leftRedirects = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];
  const rightRedirects = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];

  const redirectDiff: RedirectDiff | undefined =
    leftRedirects.length > 0 || rightRedirects.length > 0
      ? {
          left: leftRedirects,
          right: rightRedirects,
          hopCount: {
            left: leftRedirects.length,
            right: rightRedirects.length,
            changed: leftRedirects.length !== rightRedirects.length,
          },
          chainChanged: !chainsAreEqual(
            leftRedirects.map((hop) => hop.toUrl),
            rightRedirects.map((hop) => hop.toUrl)
          ),
        }
      : undefined;

  // Build partial EnvDiff (omit findings initially)
  const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    comparisonId: leftEnvelope.comparisonId,
    leftProbeId: leftEnvelope.probeId,
    rightProbeId: rightEnvelope.probeId,
    probe: probeOutcomeDiff,
    status: statusDiff,
    finalUrl: finalUrlDiff,
    redirects: redirectDiff,
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
