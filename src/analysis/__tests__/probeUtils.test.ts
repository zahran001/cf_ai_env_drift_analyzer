// src/analysis/__tests__/probeUtils.test.ts
import { compileProbeOutcomeDiff } from "../probeUtils";
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
    });
  });
});
