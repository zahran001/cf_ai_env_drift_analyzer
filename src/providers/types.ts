import type { SignalEnvelope, CfContextSnapshot } from "@shared/signal";

/**
 * Runner context extracted from Cloudflare request.cf
 * All fields are optional to support local development.
 */
export type ProviderRunnerContext = CfContextSnapshot;

/**
 * Interface for signal providers.
 * All providers must:
 * - Accept a target URL and optional runner context
 * - Return a Promise<SignalEnvelope>
 * - Never throw exceptions (always return a probe result, success or failure)
 * - Produce deterministic output (same input → identical JSON)
 */
export interface ISignalProvider {
  /**
   * Probe a target URL and return a normalized SignalEnvelope.
   *
   * @param url - The target URL to probe (http/https only)
   * @param context - Optional runner context from request.cf
   * @returns Promise resolving to a SignalEnvelope (success, HTTP error, or network failure)
   *
   * @example
   * ```typescript
   * const envelope = await provider.probe('https://example.com', { colo: 'SFO', country: 'US' });
   *
   * // Case 1: Successful response (2xx/3xx)
   * if (envelope.result.ok && 'response' in envelope.result) {
   *   console.log('Status:', envelope.result.response.status);
   *   console.log('Redirects:', envelope.result.redirects);
   * }
   *
   * // Case 2: HTTP error response (4xx/5xx)
   * if (!envelope.result.ok && 'response' in envelope.result) {
   *   console.log('Error status:', envelope.result.response.status);
   *   console.log('Is error response, not network failure');
   * }
   *
   * // Case 3: Network failure (DNS, timeout, TLS, etc.)
   * if (!envelope.result.ok && 'error' in envelope.result) {
   *   console.log('Network error:', envelope.result.error.code, envelope.result.error.message);
   * }
   * ```
   *
   * ProbeResult Semantics:
   * - ProbeSuccess: ok=true, has response field (2xx/3xx)
   * - ProbeResponseError: ok=false, has response field (4xx/5xx HTTP errors)
   * - ProbeNetworkFailure: ok=false, has error field only (DNS, timeout, TLS, SSRF, etc.)
   *
   * Invariants:
   * - Never throws exceptions
   * - Always returns a valid SignalEnvelope
   * - comparisonId and probeId set by caller before persistence
   * - side set by caller before persistence
   * - Output is deterministic (same URL + context = identical JSON)
   */
  probe(url: string, context?: ProviderRunnerContext): Promise<SignalEnvelope>;
}
