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

  // Severity: critical if scheme or host differs, warn if path/query
  const severity =
    diffTypes.includes("scheme") || diffTypes.includes("host")
      ? "critical"
      : diffTypes.length > 0
      ? "warn"
      : "info";

  return { severity, diffTypes };
}