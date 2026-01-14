import type { SignalEnvelope, CfContextSnapshot } from "../../shared/signal";

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
 * - Never throw exceptions (always return ProbeFailure on error)
 * - Produce deterministic output (same input → identical JSON)
 */
export interface ISignalProvider {
  /**
   * Probe a target URL and return a normalized SignalEnvelope.
   *
   * @param url - The target URL to probe (http/https only)
   * @param context - Optional runner context from request.cf
   * @returns Promise resolving to a SignalEnvelope (success or failure)
   *
   * @example
   * ```typescript
   * const envelope = await provider.probe('https://example.com', { colo: 'SFO', country: 'US' });
   * if (envelope.result.ok) {
   *   console.log('Status:', envelope.result.response.status);
   *   console.log('Redirects:', envelope.result.redirects);
   * } else {
   *   console.log('Error:', envelope.result.error.code, envelope.result.error.message);
   * }
   * ```
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
