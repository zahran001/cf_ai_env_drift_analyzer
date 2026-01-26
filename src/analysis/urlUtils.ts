// src/analysis/urlUtils.ts
import type { Severity } from "@shared/diff";

export interface UrlComponents {
  scheme?: string;
  host?: string;
  path?: string;
  query?: string;
}

export function parseUrlComponents(url?: string): UrlComponents {
  if (!url) return {};

  try {
    const parsed = new URL(url); // pass this string into the JavaScript URL constructor
    return {
      scheme: parsed.protocol.replace(":", "").toLowerCase(),
      host: parsed.hostname?.toLowerCase(),
      path: parsed.pathname,
      query: parsed.search, // Includes leading ?
    };
  } catch {
    // Invalid URL
    return { scheme: "invalid" };
  }
}

export interface UrlDriftResult {
  severity: Severity;
  diffTypes: ("scheme" | "host" | "path" | "query")[];
}

export function classifyUrlDrift(
  left?: string,
  right?: string
): UrlDriftResult {
  const leftUrl = parseUrlComponents(left);
  const rightUrl = parseUrlComponents(right);

  const diffTypes: ("scheme" | "host" | "path" | "query")[] = [];

  // Check each component
  if (leftUrl.scheme !== rightUrl.scheme) diffTypes.push("scheme");
  if (leftUrl.host !== rightUrl.host) diffTypes.push("host");
  if (leftUrl.path !== rightUrl.path) diffTypes.push("path");
  if (leftUrl.query !== rightUrl.query) diffTypes.push("query");

  // Determine severity based on minimal policy (symmetrical, no baseline)
  // Per SEVERITY_POLICY_A2.md: penalize host changes heavily, scheme-only benignly
  let severity: Severity;

  if (diffTypes.length === 0) {
    // No differences
    severity = "info";
  } else if (diffTypes.includes("host")) {
    // Host differs → different server/service (critical)
    severity = "critical";
  } else if (diffTypes.includes("scheme") && diffTypes.length === 1) {
    // ONLY scheme differs → often benign (HTTP→HTTPS redirect)
    severity = "info";
  } else if (diffTypes.includes("path") || diffTypes.includes("query")) {
    // Path/query differs (not host) → same destination, different resource
    severity = "warn";
  } else {
    // Fallback for edge cases (e.g., scheme + path/query but not host)
    severity = "warn";
  }

  return { severity, diffTypes };
}