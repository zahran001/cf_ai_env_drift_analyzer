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
import type { EnvDiff, Change, RedirectDiff, HeaderDiff } from "@shared/diff";
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

  // Build header diff
  const leftHeaders = leftResponse.headers;
  const rightHeaders = rightResponse.headers;

  /**
   * Compute diff for core headers only.
   * Iterates over whitelisted core header keys.
   */
  const computeCoreHeaderDiff = (): HeaderDiff<string> => {
    const added: Record<string, string> = {};
    const removed: Record<string, string> = {};
    const changedHeaders: Record<string, Change<string>> = {};
    const unchangedHeaders: Record<string, string> = {};

    const allKeys = new Set<string>();

    // Collect all keys from CORE headers
    if (leftHeaders.core) {
      Object.keys(leftHeaders.core).forEach((k) => allKeys.add(k));
    }
    if (rightHeaders.core) {
      Object.keys(rightHeaders.core).forEach((k) => allKeys.add(k));
    }

    // Classify each key
    for (const key of allKeys) {
      const leftVal = leftHeaders.core?.[key as keyof typeof leftHeaders.core];
      const rightVal = rightHeaders.core?.[key as keyof typeof rightHeaders.core];

      if (leftVal === undefined && rightVal !== undefined) {
        added[key] = rightVal;
      } else if (leftVal !== undefined && rightVal === undefined) {
        removed[key] = leftVal;
      } else if (leftVal !== rightVal) {
        changedHeaders[key] = changed(leftVal!, rightVal!);
      } else {
        unchangedHeaders[key] = leftVal!;
      }
    }

    return { added, removed, changed: changedHeaders, unchanged: unchangedHeaders };
  };

  /**
   * Compute diff for access-control-* headers only.
   * Returns undefined if neither side has access-control headers.
   */
  const computeAccessControlHeaderDiff = (): HeaderDiff<string> | undefined => {
    // Early exit if neither side has access-control headers
    if (!leftHeaders.accessControl && !rightHeaders.accessControl) {
      return undefined;
    }

    const added: Record<string, string> = {};
    const removed: Record<string, string> = {};
    const changedHeaders: Record<string, Change<string>> = {};
    const unchangedHeaders: Record<string, string> = {};

    const allKeys = new Set<string>();

    // Collect all keys from ACCESS-CONTROL headers
    if (leftHeaders.accessControl) {
      Object.keys(leftHeaders.accessControl).forEach((k) => allKeys.add(k));
    }
    if (rightHeaders.accessControl) {
      Object.keys(rightHeaders.accessControl).forEach((k) => allKeys.add(k));
    }

    // Classify each key
    for (const key of allKeys) {
      const leftVal = leftHeaders.accessControl?.[key];
      const rightVal = rightHeaders.accessControl?.[key];

      if (leftVal === undefined && rightVal !== undefined) {
        added[key] = rightVal;
      } else if (leftVal !== undefined && rightVal === undefined) {
        removed[key] = leftVal;
      } else if (leftVal !== rightVal) {
        changedHeaders[key] = changed(leftVal!, rightVal!);
      } else {
        unchangedHeaders[key] = leftVal!;
      }
    }

    // Return undefined if no changes detected (optimization)
    const hasChanges =
      Object.keys(added).length > 0 ||
      Object.keys(removed).length > 0 ||
      Object.keys(changedHeaders).length > 0;

    return hasChanges
      ? {
          added,
          removed,
          changed: changedHeaders,
          unchanged: unchangedHeaders,
        }
      : undefined;
  };

  // Compute both core and accessControl diffs
  const coreHeaderDiff = computeCoreHeaderDiff();
  const accessControlHeaderDiff = computeAccessControlHeaderDiff();

  // Debug logging
  console.log(`[computeDiff] LEFT headers.accessControl:`, JSON.stringify(leftHeaders.accessControl));
  console.log(`[computeDiff] RIGHT headers.accessControl:`, JSON.stringify(rightHeaders.accessControl));
  console.log(`[computeDiff] coreHeaderDiff.changed:`, JSON.stringify(coreHeaderDiff.changed));
  console.log(`[computeDiff] accessControlHeaderDiff:`, JSON.stringify(accessControlHeaderDiff));

  // Only include headers section if either group has changes
  const headerDiff =
    Object.keys(coreHeaderDiff.added).length > 0 ||
    Object.keys(coreHeaderDiff.removed).length > 0 ||
    Object.keys(coreHeaderDiff.changed).length > 0 ||
    accessControlHeaderDiff
      ? {
          core: coreHeaderDiff,
          accessControl: accessControlHeaderDiff,
        }
      : undefined;

  console.log(`[computeDiff] Final headerDiff:`, JSON.stringify(headerDiff));

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
    headers: headerDiff,
  };

  // Classify and generate findings
  const findings = classify(partialEnvDiff as EnvDiff);
  console.log(`[computeDiff] Generated ${findings.length} findings:`, findings.map(f => f.code).join(", "));
  const maxSeverity = computeMaxSeverity(findings);

  // Return complete diff with findings
  return {
    ...partialEnvDiff,
    findings,
    maxSeverity,
  };
}
