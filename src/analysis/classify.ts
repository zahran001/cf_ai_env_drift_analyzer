/**
 * Classify Module (Chunk 5: Rule Orchestrator)
 *
 * Responsibility: Orchestrate all 14 Phase-B2.md rules to generate deterministic DiffFinding[] from an EnvDiff.
 *
 * Reference: Phase-B2.md §5, CHUNK_5_DESIGN.md
 */

import type { EnvDiff, DiffFinding, DiffEvidence, Severity } from "@shared/diff";
import { deduplicateFindings, sortFindings } from "@shared/diff";
import { validateEvidenceKeys } from "./validators";
import { isNetworkFailure } from "./probeUtils";
import { classifyCacheControlDrift } from "./cacheUtils";
import { classifyContentTypeDrift, classifyBodyHashDrift, classifyContentLengthDrift } from "./contentUtils";
import { classifyUrlDrift } from "./urlUtils";
import { classifyRedirectChainDrift } from "./redirectUtils";
import { classifyStatusDrift } from "./classifiers";
import { TIMING_CONSTANTS } from "./constants";

/**
 * Helper: Generate deterministic finding ID from code, section, and keys.
 * Format: "${code}:${section}:${sortedKeys.join(',')}"
 */
function generateFindingId(code: string, section?: string, keys?: string[]): string {
  const sortedKeys = keys ? [...keys].sort().join(",") : "";
  if (!section) return code;
  return sortedKeys ? `${code}:${section}:${sortedKeys}` : `${code}:${section}`;
}

/**
 * Helper: Get differing access-control headers.
 * Returns sorted array of header names that differ.
 */
function getAccessControlHeaderDiffs(diff: EnvDiff): string[] {
  const acHeaders = diff.headers?.accessControl;
  if (!acHeaders) return [];

  const differing = new Set<string>();
  Object.keys(acHeaders.added || {}).forEach((k) => differing.add(k));
  Object.keys(acHeaders.removed || {}).forEach((k) => differing.add(k));
  Object.keys(acHeaders.changed || {}).forEach((k) => differing.add(k));

  return Array.from(differing).sort();
}

/**
 * Helper: Check if content-type headers differ (after normalization).
 * Normalization: extract MIME type, ignore charset and other parameters, lowercase.
 */
function normalizedContentType(value?: string): string {
  if (!value) return "";
  return value.split(";")[0].trim().toLowerCase();
}


/**
 * Helper: Classify timing drift severity.
 * critical = ratio >= 2.5 or delta >= 1000ms
 * warn = ratio >= 1.5 or delta >= 300ms
 * info = otherwise
 */
function classifyTimingDrift(left: number, right: number): Severity {
  const maxDuration = Math.max(left, right);
  const minDuration = Math.min(left, right);

  if (minDuration === 0) return "info";

  const ratio = maxDuration / minDuration;
  const delta = maxDuration - minDuration;

  if (ratio >= TIMING_CONSTANTS.RATIO_CRIT || delta >= TIMING_CONSTANTS.ABS_DELTA_CRIT_MS) return "critical";
  if (ratio >= TIMING_CONSTANTS.RATIO_WARN || delta >= TIMING_CONSTANTS.ABS_DELTA_WARN_MS) return "warn";

  return "info";
}

/**
 * Helper: Get redirect chain diff components.
 * Detects what changed: chain order, hop count, final host.
 * Returns sorted array of differing component names.
 */
function getRedirectDiffComponents(diff: EnvDiff): string[] {
  const redirectDiff = diff.redirects;
  if (!redirectDiff) return [];

  const diffs: string[] = [];

  if (redirectDiff.hopCount.changed) diffs.push("hopCount");
  if (redirectDiff.chainChanged) diffs.push("chain");

  const leftFinalHost = redirectDiff.left[redirectDiff.left.length - 1]?.toUrl;
  const rightFinalHost = redirectDiff.right[redirectDiff.right.length - 1]?.toUrl;
  if (leftFinalHost !== rightFinalHost) diffs.push("finalHost");

  return diffs.sort();
}

/**
 * Helper: Get CF context diff components.
 * Returns sorted array of differing CF context names.
 */
function getCfContextDiffComponents(diff: EnvDiff): string[] {
  const cfDiff = diff.cf;
  if (!cfDiff) return [];

  const diffs: string[] = [];
  if (cfDiff.colo?.changed) diffs.push("colo");
  if (cfDiff.asn?.changed) diffs.push("asn");
  if (cfDiff.country?.changed) diffs.push("country");

  return diffs.sort();
}

/**
 * Helper: Get unclaimed header diffs (headers not claimed by earlier rules).
 * Excludes: www-authenticate (C1), access-control-* (C2), cache-control (D1),
 * vary (D2), content-type (D3).
 */
function getUnclaimedHeaderDiffs(diff: EnvDiff): string[] {
  const allDiffingHeaders = new Set<string>();

  // Collect all differing headers from core headers
  const coreHeaders = diff.headers?.core;
  if (coreHeaders) {
    Object.keys(coreHeaders.added || {}).forEach((k) => allDiffingHeaders.add(k));
    Object.keys(coreHeaders.removed || {}).forEach((k) => allDiffingHeaders.add(k));
    Object.keys(coreHeaders.changed || {}).forEach((k) => allDiffingHeaders.add(k));
  }

  // Collect all differing access-control headers
  const acHeaders = diff.headers?.accessControl;
  if (acHeaders) {
    Object.keys(acHeaders.added || {}).forEach((k) => allDiffingHeaders.add(k));
    Object.keys(acHeaders.removed || {}).forEach((k) => allDiffingHeaders.add(k));
    Object.keys(acHeaders.changed || {}).forEach((k) => allDiffingHeaders.add(k));
  }

  if (allDiffingHeaders.size === 0) return [];

  const claimedHeaders = new Set<string>([
    "www-authenticate",
    "cache-control",
    "vary",
    "content-type",
    "location",
  ]);

  // Add all access-control-* (claimed by C2)
  Array.from(allDiffingHeaders).forEach((h) => {
    if (h.toLowerCase().startsWith("access-control-")) claimedHeaders.add(h.toLowerCase());
  });

  const unclaimed = Array.from(allDiffingHeaders)
    .filter((h) => {
      const lowerH = h.toLowerCase();
      return !claimedHeaders.has(lowerH);
    })
    .map((h) => h.toLowerCase())
    .sort();

  return unclaimed;
}

/**
 * Classify EnvDiff and generate deterministic findings.
 *
 * Per Phase-B2.md §5, evaluates all 14 rules in mandatory sequence:
 * A1/A2 (probe) → B1/B2/B3 (routing) → C1/C2 (security) → D1/D2/D3/D4/D5 (cache/content)
 * → E1 (timing) → F1 (platform) → G1 (headers catch-all)
 *
 * Then applies global determinism rules:
 * - Validate all evidence via validateEvidenceKeys()
 * - Deduplicate findings (same code + section + keys)
 * - Sort by severity (critical > warn > info), then code, then message
 *
 * DESIGN NOTE: Short-circuit only on NETWORK FAILURES (no response, only error code).
 * HTTP error responses (4xx/5xx) have status codes and should still be compared for diffs.
 *
 * @param diff - EnvDiff from probe comparison
 * @returns Array of DiffFinding items, sorted and deduplicated
 */
export function classify(diff: EnvDiff): DiffFinding[] {
  const findings: DiffFinding[] = [];

  // ========== RULE GROUP A: PROBE OUTCOME RULES ==========
  // CRITICAL DISTINCTION:
  // - ProbeSuccess: ok=true, has response (2xx/3xx)
  // - ProbeResponseError: ok=false, has response (4xx/5xx)
  // - ProbeNetworkFailure: ok=false, NO response, only error code (DNS/timeout/TLS)
  //
  // Rules A1/A2 detect when a side is a NETWORK FAILURE (no response).
  // HTTP error responses are compared normally (routing/security/cache rules apply).
  //
  // Network failure detection uses shared utility isNetworkFailure() from probeUtils.ts
  // to ensure consistent logic across diff.ts and classify.ts.

  if (!diff.probe.leftOk && !diff.probe.rightOk) {
    // Both probes reported ok=false
    // Only emit PROBE_FAILURE if BOTH are network failures (no responses)
    const leftIsNetworkFailure = isNetworkFailure(diff.probe, "left");
    const rightIsNetworkFailure = isNetworkFailure(diff.probe, "right");

    if (leftIsNetworkFailure && rightIsNetworkFailure) {
      const evidence: DiffEvidence[] = [{ section: "probe" }];
      findings.push({
        id: generateFindingId("PROBE_FAILURE", "probe"),
        code: "PROBE_FAILURE",
        category: "unknown",
        severity: "critical",
        message: "Both probes failed (network-level)",
        evidence,
        left_value: diff.probe.leftErrorCode || "Unknown error",
        right_value: diff.probe.rightErrorCode || "Unknown error",
      });
      // Short-circuit: both are network failures, no diffs to compute
      return postProcess(findings);
    }
    // Otherwise: both ok=false but both have responses (HTTP errors, e.g., 404 vs 500)
    // Fall through to normal diff rules (STATUS_MISMATCH will be emitted)
  } else if (diff.probe.leftOk !== diff.probe.rightOk) {
    // One succeeded, one reported ok=false
    // Only emit PROBE_FAILURE if the failed side is a network failure
    if (!diff.probe.leftOk && isNetworkFailure(diff.probe, "left")) {
      const evidence: DiffEvidence[] = [{ section: "probe", keys: ["left"] }];
      findings.push({
        id: generateFindingId("PROBE_FAILURE", "probe", ["left"]),
        code: "PROBE_FAILURE",
        category: "unknown",
        severity: "critical",
        message: "Left probe failed (network-level); right succeeded",
        evidence,
        left_value: diff.probe.leftErrorCode || "Unknown error",
        right_value: diff.status?.right,
      });
      // Short-circuit: left is network failure
      return postProcess(findings);
    } else if (!diff.probe.rightOk && isNetworkFailure(diff.probe, "right")) {
      const evidence: DiffEvidence[] = [{ section: "probe", keys: ["right"] }];
      findings.push({
        id: generateFindingId("PROBE_FAILURE", "probe", ["right"]),
        code: "PROBE_FAILURE",
        category: "unknown",
        severity: "critical",
        message: "Right probe failed (network-level); left succeeded",
        evidence,
        left_value: diff.status?.left,
        right_value: diff.probe.rightErrorCode || "Unknown error",
      });
      // Short-circuit: right is network failure
      return postProcess(findings);
    }
    // Otherwise: failed side has response (HTTP error), compare normally
  }

  // ========== RULE GROUP B: ROUTING RULES ==========

  if (diff.status?.changed) {
    const leftStatus = diff.status.left!;
    const rightStatus = diff.status.right!;
    const severity = classifyStatusDrift(leftStatus, rightStatus);
    const evidence: DiffEvidence[] = [{ section: "status" }];

    findings.push({
      id: generateFindingId("STATUS_MISMATCH", "status"),
      code: "STATUS_MISMATCH",
      category: "routing",
      severity,
      message: `Status differs: ${leftStatus} vs ${rightStatus}`,
      evidence,
      left_value: leftStatus,
      right_value: rightStatus,
    });
  }

  if (diff.finalUrl?.changed) {
    const leftUrl = diff.finalUrl.left!;
    const rightUrl = diff.finalUrl.right!;
    const urlDrift = classifyUrlDrift(leftUrl, rightUrl);
    const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: urlDrift.diffTypes.length > 0 ? urlDrift.diffTypes : undefined }];

    findings.push({
      id: generateFindingId("FINAL_URL_MISMATCH", "finalUrl", urlDrift.diffTypes),
      code: "FINAL_URL_MISMATCH",
      category: "routing",
      severity: urlDrift.severity,
      message: "Final URL differs after redirects",
      evidence,
      left_value: leftUrl,
      right_value: rightUrl,
    });
  }

  if (diff.redirects && (diff.redirects.chainChanged || diff.redirects.hopCount.changed)) {
    const leftChain = diff.redirects.left.map((hop) => hop.toUrl);
    const rightChain = diff.redirects.right.map((hop) => hop.toUrl);
    const chainDrift = classifyRedirectChainDrift(leftChain, rightChain);
    const diffComponents = getRedirectDiffComponents(diff);
    const evidence: DiffEvidence[] = [{ section: "redirects", keys: diffComponents.length > 0 ? diffComponents : undefined }];

    findings.push({
      id: generateFindingId("REDIRECT_CHAIN_CHANGED", "redirects", diffComponents),
      code: "REDIRECT_CHAIN_CHANGED",
      category: "routing",
      severity: chainDrift.severity,
      message: "Redirect chain differs",
      evidence,
      left_value: diff.redirects.left,
      right_value: diff.redirects.right,
    });
  }

  // ========== RULE GROUP C: SECURITY RULES ==========

  const leftWwwAuth = diff.headers?.core.changed?.["www-authenticate"]?.left;
  const rightWwwAuth = diff.headers?.core.changed?.["www-authenticate"]?.right;
  if (
    leftWwwAuth !== undefined ||
    rightWwwAuth !== undefined ||
    diff.headers?.core.added?.["www-authenticate"] !== undefined ||
    diff.headers?.core.removed?.["www-authenticate"] !== undefined
  ) {
    const hasLeft = leftWwwAuth !== undefined || diff.headers?.core.removed?.["www-authenticate"] !== undefined;
    const hasRight = rightWwwAuth !== undefined || diff.headers?.core.added?.["www-authenticate"] !== undefined;

    if (hasLeft !== hasRight) {
      const evidence: DiffEvidence[] = [{ section: "headers", keys: ["www-authenticate"] }];
      findings.push({
        id: generateFindingId("AUTH_CHALLENGE_PRESENT", "headers", ["www-authenticate"]),
        code: "AUTH_CHALLENGE_PRESENT",
        category: "security",
        severity: "critical",
        message: "www-authenticate header present on one side only",
        evidence,
        left_value: leftWwwAuth,
        right_value: rightWwwAuth,
      });
    } else if (hasLeft && hasRight && leftWwwAuth !== rightWwwAuth) {
      const evidence: DiffEvidence[] = [{ section: "headers", keys: ["www-authenticate"] }];
      findings.push({
        id: generateFindingId("AUTH_CHALLENGE_PRESENT", "headers", ["www-authenticate"]),
        code: "AUTH_CHALLENGE_PRESENT",
        category: "security",
        severity: "warn",
        message: "www-authenticate header differs",
        evidence,
        left_value: leftWwwAuth,
        right_value: rightWwwAuth,
      });
    }
  }

  const corsHeaders = getAccessControlHeaderDiffs(diff);
  if (corsHeaders.length > 0) {
    const hasAllowOriginDiff = corsHeaders.some((h) => h === "access-control-allow-origin");
    const severity: Severity = hasAllowOriginDiff ? "critical" : "warn";
    const evidence: DiffEvidence[] = [{ section: "headers", keys: corsHeaders }];

    findings.push({
      id: generateFindingId("CORS_HEADER_DRIFT", "headers", corsHeaders),
      code: "CORS_HEADER_DRIFT",
      category: "security",
      severity,
      message: "CORS headers differ",
      evidence,
      left_value: { corsHeaders },
      right_value: { corsHeaders },
    });
  }

  // ========== RULE GROUP D: CACHE & CONTENT RULES ==========

  const leftCacheControl = diff.headers?.core.changed?.["cache-control"]?.left ||
    diff.headers?.core.removed?.["cache-control"] ||
    diff.headers?.core.unchanged?.["cache-control"];
  const rightCacheControl = diff.headers?.core.changed?.["cache-control"]?.right ||
    diff.headers?.core.added?.["cache-control"] ||
    diff.headers?.core.unchanged?.["cache-control"];

  if (leftCacheControl !== rightCacheControl) {
    const severity = classifyCacheControlDrift(leftCacheControl, rightCacheControl);
    const evidence: DiffEvidence[] = [{ section: "headers", keys: ["cache-control"] }];

    findings.push({
      id: generateFindingId("CACHE_HEADER_DRIFT", "headers", ["cache-control"]),
      code: "CACHE_HEADER_DRIFT",
      category: "cache",
      severity,
      message: "Cache-control header differs",
      evidence,
      left_value: leftCacheControl,
      right_value: rightCacheControl,
    });
  }

  const leftVary = diff.headers?.core.changed?.vary?.left ||
    diff.headers?.core.removed?.vary ||
    diff.headers?.core.unchanged?.vary;
  const rightVary = diff.headers?.core.changed?.vary?.right ||
    diff.headers?.core.added?.vary ||
    diff.headers?.core.unchanged?.vary;

  if (leftVary !== rightVary) {
    const evidence: DiffEvidence[] = [{ section: "headers", keys: ["vary"] }];

    findings.push({
      id: generateFindingId("UNKNOWN_DRIFT", "headers", ["vary"]),
      code: "UNKNOWN_DRIFT",
      category: "unknown",
      severity: "warn",
      message: "Vary header differs",
      evidence,
      left_value: leftVary,
      right_value: rightVary,
    });
  }

  const leftContentType = diff.headers?.core.changed?.["content-type"]?.left ||
    diff.headers?.core.removed?.["content-type"] ||
    diff.headers?.core.unchanged?.["content-type"];
  const rightContentType = diff.headers?.core.changed?.["content-type"]?.right ||
    diff.headers?.core.added?.["content-type"] ||
    diff.headers?.core.unchanged?.["content-type"];

  if (normalizedContentType(leftContentType) !== normalizedContentType(rightContentType)) {
    const severity = classifyContentTypeDrift(leftContentType, rightContentType);
    const evidence: DiffEvidence[] = [{ section: "headers", keys: ["content-type"] }];

    findings.push({
      id: generateFindingId("CONTENT_TYPE_DRIFT", "headers", ["content-type"]),
      code: "CONTENT_TYPE_DRIFT",
      category: "content",
      severity,
      message: "Content-Type differs",
      evidence,
      left_value: leftContentType,
      right_value: rightContentType,
    });
  }

  if (diff.content?.bodyHash?.changed && diff.status && !diff.status.changed && diff.content.contentType && !diff.content.contentType.changed) {
    const severity = classifyBodyHashDrift();
    const evidence: DiffEvidence[] = [{ section: "content", keys: ["body-hash"] }];

    findings.push({
      id: generateFindingId("BODY_HASH_DRIFT", "content", ["body-hash"]),
      code: "BODY_HASH_DRIFT",
      category: "content",
      severity,
      message: "Response body content differs",
      evidence,
      left_value: diff.content.bodyHash.left,
      right_value: diff.content.bodyHash.right,
    });
  }

  if (diff.content?.contentLength?.changed) {
    const severity = classifyContentLengthDrift(
      diff.content.contentLength.left,
      diff.content.contentLength.right,
      diff.status?.changed || false
    );
    const delta = Math.abs((diff.content.contentLength.right || 0) - (diff.content.contentLength.left || 0));
    const evidence: DiffEvidence[] = [{ section: "content", keys: ["content-length"] }];

    findings.push({
      id: generateFindingId("CONTENT_LENGTH_DRIFT", "content", ["content-length"]),
      code: "CONTENT_LENGTH_DRIFT",
      category: "content",
      severity,
      message: `Content-Length differs by ${delta} bytes`,
      evidence,
      left_value: diff.content.contentLength.left,
      right_value: diff.content.contentLength.right,
    });
  }

  // ========== RULE GROUP E: TIMING RULES ==========

  if (diff.timing?.durationMs?.changed) {
    const leftDuration = diff.timing.durationMs.left || 0;
    const rightDuration = diff.timing.durationMs.right || 0;
    const maxDuration = Math.max(leftDuration, rightDuration);

    if (maxDuration >= TIMING_CONSTANTS.MIN_TIMING_LEFT_MS) {
      const severity = classifyTimingDrift(leftDuration, rightDuration);
      const evidence: DiffEvidence[] = [{ section: "timing", keys: ["duration_ms"] }];

      findings.push({
        id: generateFindingId("TIMING_DRIFT", "timing", ["duration_ms"]),
        code: "TIMING_DRIFT",
        category: "timing",
        severity,
        message: `Response duration differs: ${leftDuration}ms vs ${rightDuration}ms`,
        evidence,
        left_value: leftDuration,
        right_value: rightDuration,
      });
    }
  }

  // ========== RULE GROUP F: PLATFORM RULES ==========

  const cfDiffComponents = getCfContextDiffComponents(diff);
  if (cfDiffComponents.length > 0) {
    const timingDriftPresent = findings.some((f) => f.code === "TIMING_DRIFT");
    const severity: Severity = timingDriftPresent ? "warn" : "info";
    const evidence: DiffEvidence[] = [{ section: "cf", keys: cfDiffComponents }];

    findings.push({
      id: generateFindingId("CF_CONTEXT_DRIFT", "cf", cfDiffComponents),
      code: "CF_CONTEXT_DRIFT",
      category: "platform",
      severity,
      message: "Cloudflare context differs (colo/asn/country)",
      evidence,
      left_value: { colo: diff.cf?.colo?.left, asn: diff.cf?.asn?.left, country: diff.cf?.country?.left },
      right_value: { colo: diff.cf?.colo?.right, asn: diff.cf?.asn?.right, country: diff.cf?.country?.right },
    });
  }

  // ========== RULE GROUP G: CATCH-ALL HEADER RULE ==========

  const unclaimedHeaders = getUnclaimedHeaderDiffs(diff);
  if (unclaimedHeaders.length > 0) {
    const severity: Severity = unclaimedHeaders.length >= 3 ? "warn" : "info";
    const evidence: DiffEvidence[] = [{ section: "headers", keys: unclaimedHeaders }];

    findings.push({
      id: generateFindingId("UNKNOWN_DRIFT", "headers", unclaimedHeaders),
      code: "UNKNOWN_DRIFT",
      category: "unknown",
      severity,
      message: `${unclaimedHeaders.length} header(s) differ: ${unclaimedHeaders.join(", ")}`,
      evidence,
      left_value: { unclaimed: unclaimedHeaders },
      right_value: { unclaimed: unclaimedHeaders },
    });
  }

  return postProcess(findings);
}

/**
 * Post-processing: Validate evidence, deduplicate, sort findings.
 * @param findings - Raw findings array
 * @returns Processed findings (validated, deduplicated, sorted)
 */
function postProcess(findings: DiffFinding[]): DiffFinding[] {
  const allEvidence = findings.flatMap((f) => f.evidence || []);
  if (allEvidence.length > 0 && !validateEvidenceKeys(allEvidence)) {
    throw new Error("Evidence validation failed: One or more findings have invalid evidence");
  }

  const deduplicated = deduplicateFindings(findings);
  const sorted = sortFindings(deduplicated);

  return sorted;
}
