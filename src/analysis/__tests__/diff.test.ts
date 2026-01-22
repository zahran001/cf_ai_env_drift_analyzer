/**
 * Tests for computeDiff function
 *
 * Verifies that:
 * 1. HTTP error responses (4xx/5xx) compute full diff with status comparison
 * 2. Network failures (DNS/timeout/TLS) early-exit with minimal diff
 * 3. Discriminant logic correctly distinguishes cases using status presence
 */

import { computeDiff } from "../diff";
import type { FrozenSignalEnvelope } from "@shared/signal";

/**
 * Helper to create a successful SignalEnvelope (2xx)
 */
function createSuccessEnvelope(overrides: any = {}): FrozenSignalEnvelope {
  return {
    schemaVersion: 1,
    comparisonId: "test-comparison",
    probeId: "probe-" + Math.random().toString(36).substring(7),
    side: "left",
    requestedUrl: "http://example.com",
    capturedAt: new Date().toISOString(),
    result: {
      ok: true,
      response: {
        status: 200,
        finalUrl: "http://example.com",
        headers: {
          core: { "content-type": "text/html" },
        },
      },
      durationMs: 100,
    },
    ...overrides,
  } as FrozenSignalEnvelope;
}

/**
 * Helper to create an HTTP error envelope (4xx/5xx)
 */
function createHttpErrorEnvelope(
  status: number,
  overrides: any = {}
): FrozenSignalEnvelope {
  return {
    schemaVersion: 1,
    comparisonId: "test-comparison",
    probeId: "probe-" + Math.random().toString(36).substring(7),
    side: "left",
    requestedUrl: "http://example.com",
    capturedAt: new Date().toISOString(),
    result: {
      ok: false,
      response: {
        status,
        finalUrl: "http://example.com",
        headers: {
          core: { "content-type": "text/html" },
        },
      },
      durationMs: 100,
    },
    ...overrides,
  } as FrozenSignalEnvelope;
}

/**
 * Helper to create a network failure envelope (DNS/timeout/TLS)
 */
function createNetworkFailureEnvelope(
  errorCode: string,
  overrides: any = {}
): FrozenSignalEnvelope {
  return {
    schemaVersion: 1,
    comparisonId: "test-comparison",
    probeId: "probe-" + Math.random().toString(36).substring(7),
    side: "left",
    requestedUrl: "http://example.com",
    capturedAt: new Date().toISOString(),
    result: {
      ok: false,
      error: {
        code: errorCode as any,
        message: `Network error: ${errorCode}`,
      },
      durationMs: 100,
    },
    ...overrides,
  } as FrozenSignalEnvelope;
}

describe("computeDiff", () => {
  describe("HTTP Success vs Success", () => {
    it("should compute minimal diff for 200 vs 200 (identical)", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createSuccessEnvelope({
        probeId: "right-probe",
        side: "right",
        result: {
          ok: true,
          response: {
            status: 200,
            finalUrl: "http://example.com",
            headers: { core: { "content-type": "text/html" } },
          },
          durationMs: 100,
        },
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.leftOk).toBe(true);
      expect(diff.probe.rightOk).toBe(true);
      expect(diff.probe.outcomeChanged).toBe(false);
      expect(diff.probe.responsePresent).toBe(true);
      expect(diff.status?.changed).toBe(false);
      expect(diff.status?.left).toBe(200);
      expect(diff.status?.right).toBe(200);
      // No PROBE_FAILURE for success
      expect(diff.findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);
    });
  });

  describe("HTTP Success vs HTTP Error Response", () => {
    it("should compute full diff for 200 vs 404 (both have responses)", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createHttpErrorEnvelope(404, {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      // Probe outcome
      expect(diff.probe.leftOk).toBe(true);
      expect(diff.probe.rightOk).toBe(false);
      expect(diff.probe.outcomeChanged).toBe(true);
      expect(diff.probe.responsePresent).toBe(true);

      // Status diff should be computed (key distinction from network failures)
      expect(diff.status).toBeDefined();
      expect(diff.status?.changed).toBe(true);
      expect(diff.status?.left).toBe(200);
      expect(diff.status?.right).toBe(404);

      // Should NOT short-circuit; STATUS_MISMATCH should be emitted
      const statusMismatch = diff.findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch?.severity).toBe("critical");

      // Should NOT emit PROBE_FAILURE (HTTP error responses are not probe failures)
      expect(diff.findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);
    });

    it("should compute full diff for 200 vs 500", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createHttpErrorEnvelope(500, {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.responsePresent).toBe(true);
      expect(diff.status?.changed).toBe(true);
      expect(diff.status?.left).toBe(200);
      expect(diff.status?.right).toBe(500);

      const statusMismatch = diff.findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      expect(diff.findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);
    });

    it("should compute diff for 404 vs 500 (both error responses)", () => {
      const left = createHttpErrorEnvelope(404, {
        probeId: "left-probe",
        side: "left",
      });
      const right = createHttpErrorEnvelope(500, {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.leftOk).toBe(false);
      expect(diff.probe.rightOk).toBe(false);
      expect(diff.probe.responsePresent).toBe(true);
      expect(diff.status?.changed).toBe(true);
      expect(diff.status?.left).toBe(404);
      expect(diff.status?.right).toBe(500);

      // Both have responses, so STATUS_MISMATCH should be emitted
      const statusMismatch = diff.findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
    });
  });

  describe("Network Failures - Early Exit", () => {
    it("should early-exit for 200 vs DNS_ERROR (right is network failure)", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createNetworkFailureEnvelope("dns_error", {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      // Probe outcome
      expect(diff.probe.leftOk).toBe(true);
      expect(diff.probe.rightOk).toBe(false);
      expect(diff.probe.rightErrorCode).toBe("dns_error");
      expect(diff.probe.outcomeChanged).toBe(true);
      expect(diff.probe.responsePresent).toBe(false);

      // Status diff should NOT be computed (early exit)
      expect(diff.status).toBeUndefined();

      // Should emit PROBE_FAILURE for network failure
      const probeFailure = diff.findings.find((f) => f.code === "PROBE_FAILURE");
      expect(probeFailure).toBeDefined();
      expect(probeFailure?.severity).toBe("critical");
      expect(probeFailure?.message).toContain("network-level");
    });

    it("should early-exit for DNS_ERROR vs 200 (left is network failure)", () => {
      const left = createNetworkFailureEnvelope("timeout", {
        probeId: "left-probe",
        side: "left",
      });
      const right = createSuccessEnvelope({
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.leftOk).toBe(false);
      expect(diff.probe.leftErrorCode).toBe("timeout");
      expect(diff.probe.responsePresent).toBe(false);
      expect(diff.status).toBeUndefined();

      const probeFailure = diff.findings.find((f) => f.code === "PROBE_FAILURE");
      expect(probeFailure).toBeDefined();
      expect(probeFailure?.message).toContain("network-level");
    });

    it("should early-exit for DNS_ERROR vs TLS_ERROR (both network failures)", () => {
      const left = createNetworkFailureEnvelope("dns_error", {
        probeId: "left-probe",
        side: "left",
      });
      const right = createNetworkFailureEnvelope("tls_error", {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.leftOk).toBe(false);
      expect(diff.probe.rightOk).toBe(false);
      expect(diff.probe.leftErrorCode).toBe("dns_error");
      expect(diff.probe.rightErrorCode).toBe("tls_error");
      expect(diff.probe.responsePresent).toBe(false);
      expect(diff.status).toBeUndefined();

      const probeFailure = diff.findings.find((f) => f.code === "PROBE_FAILURE");
      expect(probeFailure).toBeDefined();
      expect(probeFailure?.message).toContain("Both probes failed");
    });
  });

  describe("Discriminant Logic - Key Distinction", () => {
    it("should distinguish 200 vs 404 from 200 vs DNS_ERROR by status presence", () => {
      // Case 1: HTTP error (4xx) - both have status
      const left1 = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right1 = createHttpErrorEnvelope(404, {
        probeId: "right-probe",
        side: "right",
      });
      const diff1 = computeDiff(left1, right1);

      // Case 2: Network failure - right has no status
      const left2 = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right2 = createNetworkFailureEnvelope("dns_error", {
        probeId: "right-probe",
        side: "right",
      });
      const diff2 = computeDiff(left2, right2);

      // Both have rightOk=false, but different outcomes:
      expect(diff1.probe.rightOk).toBe(false);
      expect(diff2.probe.rightOk).toBe(false);

      // responsePresent flag clearly distinguishes the cases
      expect(diff1.probe.responsePresent).toBe(true);
      expect(diff2.probe.responsePresent).toBe(false);

      // Case 1 has status (HTTP error), Case 2 does not (network failure)
      expect(diff1.status).toBeDefined();
      expect(diff2.status).toBeUndefined();

      // Case 1 emits STATUS_MISMATCH, Case 2 emits PROBE_FAILURE
      expect(diff1.findings.some((f) => f.code === "STATUS_MISMATCH")).toBe(true);
      expect(diff1.findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);

      expect(diff2.findings.some((f) => f.code === "PROBE_FAILURE")).toBe(true);
      expect(diff2.findings.some((f) => f.code === "STATUS_MISMATCH")).toBe(false);
    });
  });

  describe("RedirectHop and FinalUrl Tracking", () => {
    it("should preserve finalUrl for 404 response after redirect", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createHttpErrorEnvelope(404, {
        probeId: "right-probe",
        side: "right",
        result: {
          ok: false,
          response: {
            status: 404,
            finalUrl: "http://example.com/redirected",
            headers: { core: { "content-type": "text/html" } },
          },
          redirects: [
            {
              fromUrl: "http://example.com",
              toUrl: "http://example.com/redirected",
              status: 301,
            },
          ],
          durationMs: 150,
        },
      });

      const diff = computeDiff(left, right);

      // Both have responses
      expect(diff.status).toBeDefined();
      expect(diff.finalUrl).toBeDefined();

      // FinalUrl should differ (left went to /, right went to /redirected after 301)
      expect(diff.finalUrl?.left).toBe("http://example.com");
      expect(diff.finalUrl?.right).toBe("http://example.com/redirected");

      // STATUS_MISMATCH should be emitted
      expect(diff.findings.some((f) => f.code === "STATUS_MISMATCH")).toBe(true);
    });
  });

  describe("Error Code Capture", () => {
    it("should capture leftErrorCode and rightErrorCode in probe outcome diff", () => {
      const left = createNetworkFailureEnvelope("dns_error", {
        probeId: "left-probe",
        side: "left",
      });
      const right = createNetworkFailureEnvelope("timeout", {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      expect(diff.probe.leftErrorCode).toBe("dns_error");
      expect(diff.probe.rightErrorCode).toBe("timeout");

      // Error codes should be in the PROBE_FAILURE finding
      const probeFailure = diff.findings.find((f) => f.code === "PROBE_FAILURE");
      expect(probeFailure?.left_value).toBe("dns_error");
      expect(probeFailure?.right_value).toBe("timeout");
    });

    it("should not set error codes when probes have responses", () => {
      const left = createSuccessEnvelope({
        probeId: "left-probe",
        side: "left",
      });
      const right = createHttpErrorEnvelope(404, {
        probeId: "right-probe",
        side: "right",
      });

      const diff = computeDiff(left, right);

      // No error codes for HTTP responses
      expect(diff.probe.leftErrorCode).toBeUndefined();
      expect(diff.probe.rightErrorCode).toBeUndefined();
    });
  });
});