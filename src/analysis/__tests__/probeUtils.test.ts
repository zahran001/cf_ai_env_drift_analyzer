// src/analysis/__tests__/probeUtils.test.ts
import { compileProbeOutcomeDiff, isNetworkFailure } from "../probeUtils";
import type { SignalEnvelope } from "@shared/diff";
import { SIGNAL_SCHEMA_VERSION } from "@shared/signal";

describe("probeUtils", () => {
  it("A1: Both probes failed", () => {
    const left: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-left",
      side: "left",
      requestedUrl: "https://left.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: false,
        error: { code: "timeout", message: "Request timed out" },
      },
    };

    const right: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-right",
      side: "right",
      requestedUrl: "https://right.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: false,
        error: { code: "dns_error", message: "DNS resolution failed" },
      },
    };

    const diff = compileProbeOutcomeDiff(left, right);

    expect(diff).toEqual({
      leftOk: false,
      rightOk: false,
      leftErrorCode: "timeout",
      rightErrorCode: "dns_error",
      outcomeChanged: false,
      responsePresent: false,
    });
  });

  it("A2: One probe failed (left)", () => {
    const left: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-left",
      side: "left",
      requestedUrl: "https://left.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: false,
        error: { code: "timeout", message: "Request timed out" },
      },
    };

    const right: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-right",
      side: "right",
      requestedUrl: "https://right.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: true,
        response: {
          status: 200,
          finalUrl: "https://right.com",
          headers: { core: {} },
          contentLength: 1000,
        },
        durationMs: 100,
      },
    };

    const diff = compileProbeOutcomeDiff(left, right);

    expect(diff).toEqual({
      leftOk: false,
      rightOk: true,
      leftErrorCode: "timeout",
      rightErrorCode: undefined,
      outcomeChanged: true,
      responsePresent: false,
    });
  });

  it("A2: One probe failed (right)", () => {
    const left: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-left",
      side: "left",
      requestedUrl: "https://left.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: true,
        response: {
          status: 200,
          finalUrl: "https://left.com",
          headers: { core: {} },
          contentLength: 1000,
        },
        durationMs: 100,
      },
    };

    const right: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-right",
      side: "right",
      requestedUrl: "https://right.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: false,
        error: { code: "fetch_error", message: "Fetch failed" },
      },
    };

    const diff = compileProbeOutcomeDiff(left, right);

    expect(diff).toEqual({
      leftOk: true,
      rightOk: false,
      leftErrorCode: undefined,
      rightErrorCode: "fetch_error",
      outcomeChanged: true,
      responsePresent: false,
    });
  });

  it("Both probes succeeded", () => {
    const left: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-left",
      side: "left",
      requestedUrl: "https://left.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: true,
        response: {
          status: 200,
          finalUrl: "https://left.com",
          headers: { core: {} },
          contentLength: 1000,
        },
        durationMs: 100,
      },
    };

    const right: SignalEnvelope = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "comp-1",
      probeId: "probe-right",
      side: "right",
      requestedUrl: "https://right.com",
      capturedAt: "2024-01-01T00:00:00Z",
      result: {
        ok: true,
        response: {
          status: 200,
          finalUrl: "https://right.com",
          headers: { core: {} },
          contentLength: 1000,
        },
        durationMs: 100,
      },
    };

    const diff = compileProbeOutcomeDiff(left, right);

    expect(diff).toEqual({
      leftOk: true,
      rightOk: true,
      leftErrorCode: undefined,
      rightErrorCode: undefined,
      outcomeChanged: false,
      responsePresent: true,
    });
  });
});

describe("isNetworkFailure", () => {
  it("should detect network failure when error code present and responsePresent=false", () => {
    const probe = {
      leftOk: false,
      rightOk: true,
      leftErrorCode: "dns_error",
      rightErrorCode: undefined,
      outcomeChanged: true,
      responsePresent: false,
    };

    expect(isNetworkFailure(probe, "left")).toBe(true);
    expect(isNetworkFailure(probe, "right")).toBe(false);
  });

  it("should not detect network failure when HTTP error response (error code undefined)", () => {
    const probe = {
      leftOk: false,
      rightOk: true,
      leftErrorCode: undefined, // No error code for HTTP error response
      rightErrorCode: undefined,
      outcomeChanged: true,
      responsePresent: true, // Both have responses
    };

    expect(isNetworkFailure(probe, "left")).toBe(false);
    expect(isNetworkFailure(probe, "right")).toBe(false);
  });

  it("should not detect network failure when responsePresent=true (both have responses)", () => {
    const probe = {
      leftOk: false,
      rightOk: true,
      leftErrorCode: "timeout", // Error code present but...
      rightErrorCode: undefined,
      outcomeChanged: true,
      responsePresent: true, // ...both have responses (should be HTTP error)
    };

    // Even with error code, if responsePresent is true, not a network failure
    expect(isNetworkFailure(probe, "left")).toBe(false);
  });

  it("should detect network failure on right side", () => {
    const probe = {
      leftOk: true,
      rightOk: false,
      leftErrorCode: undefined,
      rightErrorCode: "tls_error",
      outcomeChanged: true,
      responsePresent: false,
    };

    expect(isNetworkFailure(probe, "left")).toBe(false);
    expect(isNetworkFailure(probe, "right")).toBe(true);
  });

  it("should detect both network failures", () => {
    const probe = {
      leftOk: false,
      rightOk: false,
      leftErrorCode: "dns_error",
      rightErrorCode: "timeout",
      outcomeChanged: false,
      responsePresent: false,
    };

    expect(isNetworkFailure(probe, "left")).toBe(true);
    expect(isNetworkFailure(probe, "right")).toBe(true);
  });
});
