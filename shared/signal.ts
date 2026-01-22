import type { Json } from "./json";

/**
 * Increment only when the stored shape changes in a breaking way.
 */
export const SIGNAL_SCHEMA_VERSION = 1;

export type ProbeSide = "left" | "right";

/**
 * Stable, narrow error taxonomy.
 * Expand cautiously.
 */
export type ProbeErrorCode =
  | "invalid_url"
  | "dns_error"
  | "timeout"
  | "tls_error"
  | "ssrf_blocked"
  | "fetch_error"
  | "unknown_error";

export type ProbeError = {
  code: ProbeErrorCode;
  message: string;

  /**
   * Optional, safe metadata.
   * Example: { timeoutMs: 10000 }
   */
  details?: Record<string, unknown>;
};

/**
 * One redirect hop in a manual redirect chain.
 */
export type RedirectHop = {
  fromUrl: string;
  toUrl: string;
  status: number;
};

/**
 * Core allowlisted headers.
 * Keys MUST be lowercase.
 */
export type CoreResponseHeaders = Partial<{
  "cache-control": string;
  "content-type": string;
  "vary": string;
  "www-authenticate": string;
  "location": string;
}>;

/**
 * Access-Control-* headers grouped explicitly.
 * Keys MUST start with "access-control-".
 */
export type AccessControlHeaders = Record<string, string>;

/**
 * Curated response header snapshot.
 */
export type ResponseHeadersSnapshot = {
  core: CoreResponseHeaders;
  accessControl?: AccessControlHeaders;
};

/**
 * Minimal, safe response metadata.
 */
export type ResponseMetadata = {
  status: number;
  finalUrl: string;

  headers: ResponseHeadersSnapshot;

  contentLength?: number;
  bodyHash?: string; // e.g. sha256, hex-encoded
};

/**
 * Safe subset of request.cf
 */
export type CfContextSnapshot = Partial<{
  colo: string;
  country: string;
  asn: number;
  asOrganization: string;
  tlsVersion: string;
  httpProtocol: string;
}>;

/**
 * Successful probe result.
 */
export type ProbeSuccess = {
  ok: true;

  response: ResponseMetadata;

  redirects?: RedirectHop[];

  durationMs: number;
};

/**
 * Failed probe result.
 */
export type ProbeFailure = {
  ok: false;

  error: ProbeError;

  durationMs?: number;
};

/**
 * Union of possible probe outcomes.
 */
export type ProbeResult = ProbeSuccess | ProbeFailure;

/**
 * The canonical signal envelope.
 * This is the primary persisted artifact.
 */
export type SignalEnvelope = {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;

  comparisonId: string;
  probeId: string;

  side: ProbeSide;

  /**
   * Original requested URL.
   */
  requestedUrl: string;

  /**
   * When the probe was executed.
   */
  capturedAt: string; // ISO 8601

  /**
   * Execution context (safe subset).
   */
  cf?: CfContextSnapshot;

  /**
   * Outcome of the probe.
   */
  result: ProbeResult;
};

/**
 * FrozenSignalEnvelope: A JSON-serialized SignalEnvelope.
 *
 * Used when SignalEnvelope passes through Cloudflare Workflows step.do()
 * or any other serialization boundary. The type enforces that only JSON-safe
 * shapes can be used (no methods, Date objects, or other non-serializable types).
 *
 * This is a structural type alias; it has no runtime cost and communicates
 * intent: "this envelope has been serialized and deserialized, so treat it
 * as its JSON shape only."
 *
 * Intersection with Json constrains SignalEnvelope to its JSON-serializable form.
 * This expresses: "SignalEnvelope, but only its JSON shape"

 */
export type FrozenSignalEnvelope = SignalEnvelope & Json;
