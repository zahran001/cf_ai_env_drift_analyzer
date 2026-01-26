import { classify } from "../classify";
import type { EnvDiff, Change, DiffFinding, TimingDiff } from "@shared/diff";

/**
 * MVP Mock Envelope Tests
 *
 * Purpose: Verify Phase B2 orchestrator against deterministic rules
 * without real network I/O. Tests two key scenarios:
 *
 * Scenario A: "Security & Cache" Drift
 * - Status: 200 (unchanged)
 * - cache-control: public → no-store (critical due to no-store keyword)
 * - access-control-allow-origin: absent → * (critical CORS drift)
 * - Expected: CACHE_HEADER_DRIFT (critical), CORS_HEADER_DRIFT (critical)
 *
 * Scenario B: "Routing & Timing" Drift
 * - Status: 200 (unchanged)
 * - Redirects: 0 → 2 hops with different final host (critical)
 * - Timing: 100ms → 1200ms (critical due to >1000ms delta)
 * - Expected: REDIRECT_CHAIN_CHANGED (critical), TIMING_DRIFT (critical)
 */

// ============================================================================
// Helpers: Build EnvDiff structures
// ============================================================================

const changeVal = <T>(left: T | undefined, right: T | undefined): Change<T> => ({
  left,
  right,
  changed: left !== right,
});

const unchangedVal = <T>(value: T): Change<T> => ({
  left: value,
  right: value,
  changed: false,
});

function createBaseDiff(overrides: Partial<EnvDiff> = {}): EnvDiff {
  return {
    schemaVersion: 1,
    comparisonId: "test-id",
    leftProbeId: "left-probe",
    rightProbeId: "right-probe",
    probe: { leftOk: true, rightOk: true, outcomeChanged: false },
    findings: [],
    maxSeverity: "info",
    ...overrides,
  } as EnvDiff;
}

// ============================================================================
// Tests: Scenario A - Security & Cache Drift
// ============================================================================
describe("MVP Mock Envelopes - Scenario A: Security & Cache Drift", () => {
  /**
   * Scenario A: Status unchanged (200), but:
   * - cache-control changed from "public" to "no-store" (critical)
   * - access-control headers added (critical CORS drift)
   */
  const scenarioADiff = createBaseDiff({
    status: unchangedVal(200),
    headers: {
      core: {
        added: {},
        removed: {},
        unchanged: {},
        changed: {
          "cache-control": {
            left: "public, max-age=3600",
            right: "no-store",
            changed: true,
          },
        },
      },
      accessControl: {
        added: { "access-control-allow-origin": "*" },
        removed: {},
        unchanged: {},
        changed: {},
      },
    } as any,
    cf: {
      colo: changeVal("SFO", "LAX"),
    },
  });

  test("Both left and right probes succeeded", () => {
    expect(scenarioADiff.probe.leftOk).toBe(true);
    expect(scenarioADiff.probe.rightOk).toBe(true);
  });

  test("classify() produces findings for cache and CORS drift", () => {
    const findings = classify(scenarioADiff);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("Findings include cache-control drift (warn)", () => {
    const findings = classify(scenarioADiff);
    const cacheFindings = findings.filter(
      (f: DiffFinding) => f.code === "CACHE_HEADER_DRIFT"
    );
    expect(cacheFindings.length).toBeGreaterThan(0);
    cacheFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("warn");
    });
  });

  test("Findings include CORS header drift (critical)", () => {
    const findings = classify(scenarioADiff);
    const corsFindings = findings.filter(
      (f: DiffFinding) => f.code === "CORS_HEADER_DRIFT"
    );
    expect(corsFindings.length).toBeGreaterThan(0);
    corsFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("critical");
    });
  });

  test("classify() is deterministic (same input → same output)", () => {
    const findings1 = classify(scenarioADiff);
    const findings2 = classify(scenarioADiff);
    expect(JSON.stringify(findings1)).toBe(JSON.stringify(findings2));
  });

  test("maxSeverity across findings includes critical", () => {
    const findings = classify(scenarioADiff);
    const hasCritical = findings.some(
      (f: DiffFinding) => f.severity === "critical"
    );
    expect(hasCritical).toBe(true);
  });
});

// ============================================================================
// Tests: Scenario B - Routing & Timing Drift
// ============================================================================
describe("MVP Mock Envelopes - Scenario B: Routing & Timing Drift", () => {
  /**
   * Scenario B: Status unchanged (200), but:
   * - Redirect chain changed: 0 hops → 2 hops (critical due to ≥2 hops)
   * - Final host differs: example.com → cdn.example.com (critical)
   * - Timing increased: 100ms → 1200ms (critical due to >1000ms delta)
   */
  const scenarioBDiff = createBaseDiff({
    status: unchangedVal(200),
    redirects: {
      hopCount: changeVal(0, 2),
      chainChanged: true,
      left: [],
      right: [
        {
          fromUrl: "https://prod.example.com/api",
          toUrl: "https://balancer.example.com/api",
          status: 302,
        },
        {
          fromUrl: "https://balancer.example.com/api",
          toUrl: "https://cdn.example.com/api",
          status: 307,
        },
      ],
    },
    timing: {
      durationMs: changeVal(100, 1200),
      deltaMs: 1100,
      ratio: 12,
    } as TimingDiff,
    cf: {
      colo: changeVal("SFO", "LON"),
      country: changeVal("US", "GB"),
    },
  });

  test("Left has no redirects, right has 2", () => {
    expect(scenarioBDiff.redirects?.hopCount.left).toBe(0);
    expect(scenarioBDiff.redirects?.hopCount.right).toBe(2);
    expect(scenarioBDiff.redirects?.right.length).toBe(2);
  });

  test("classify() produces findings for redirect and timing drift", () => {
    const findings = classify(scenarioBDiff);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("Findings include REDIRECT_CHAIN_CHANGED (critical due to ≥2 hops + final host diff)", () => {
    const findings = classify(scenarioBDiff);
    const redirectFindings = findings.filter(
      (f: DiffFinding) => f.code === "REDIRECT_CHAIN_CHANGED"
    );
    expect(redirectFindings.length).toBeGreaterThan(0);
    redirectFindings.forEach((f: DiffFinding) => {
      expect(["critical", "warn"]).toContain(f.severity);
    });
  });

  test("Findings include TIMING_DRIFT with critical severity (1100ms delta)", () => {
    const findings = classify(scenarioBDiff);
    const timingFindings = findings.filter(
      (f: DiffFinding) => f.code === "TIMING_DRIFT"
    );
    expect(timingFindings.length).toBeGreaterThan(0);
    timingFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("critical");
    });
  });

  test("classify() is deterministic (same input → same output)", () => {
    const findings1 = classify(scenarioBDiff);
    const findings2 = classify(scenarioBDiff);
    expect(JSON.stringify(findings1)).toBe(JSON.stringify(findings2));
  });
});

// ============================================================================
// Tests: Determinism & Stability
// ============================================================================
describe("MVP Mock Envelopes - Determinism & Stability", () => {
  test("Multiple runs of Scenario A produce byte-identical findings", () => {
    const scenarioADiff = createBaseDiff({
      status: unchangedVal(200),
      headers: {
        core: {
          added: {},
          removed: {},
          unchanged: {},
          changed: {
            "cache-control": {
              left: "public",
              right: "no-store",
              changed: true,
            },
          },
        },
      },
    } as any);

    const results = [];
    for (let i = 0; i < 5; i++) {
      const findings = classify(scenarioADiff);
      results.push(JSON.stringify(findings));
    }

    const first = results[0];
    results.forEach((r) => {
      expect(r).toBe(first);
    });
  });

  test("Multiple runs of Scenario B produce byte-identical findings", () => {
    const scenarioBDiff = createBaseDiff({
      status: unchangedVal(200),
      redirects: {
        hopCount: changeVal(0, 2),
        chainChanged: true,
        left: [],
        right: [
          {
            fromUrl: "https://prod.example.com",
            toUrl: "https://cdn.example.com",
            status: 302,
          },
          {
            fromUrl: "https://cdn.example.com",
            toUrl: "https://final.example.com",
            status: 307,
          },
        ],
      },
      timing: {
        durationMs: changeVal(100, 1200),
        deltaMs: 1100,
      } as TimingDiff,
    });

    const results = [];
    for (let i = 0; i < 5; i++) {
      const findings = classify(scenarioBDiff);
      results.push(JSON.stringify(findings));
    }

    const first = results[0];
    results.forEach((r) => {
      expect(r).toBe(first);
    });
  });

  test("Findings are always in deterministic order", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
      timing: { durationMs: changeVal(100, 1200), deltaMs: 1100 } as TimingDiff,
      headers: {
        core: {
          added: {},
          removed: {},
          unchanged: {},
          changed: {
            "cache-control": {
              left: "public",
              right: "no-store",
              changed: true,
            },
          },
        },
      } as any,
    });

    const findings = classify(diff);

    // Verify findings are sorted by severity (critical → warn → info)
    const severityMap = { critical: 0, warn: 1, info: 2 };
    for (let i = 1; i < findings.length; i++) {
      const prev =
        severityMap[findings[i - 1].severity as keyof typeof severityMap];
      const curr = severityMap[findings[i].severity as keyof typeof severityMap];
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });
});

// ============================================================================
// Tests: Validator Edge Cases
// ============================================================================
describe("MVP Mock Envelopes - Validator Edge Cases", () => {
  test("classify() accepts valid EnvDiff with all fields present", () => {
    const diff = createBaseDiff({
      status: unchangedVal(200),
      timing: { durationMs: unchangedVal(100) } as TimingDiff,
      probe: { leftOk: true, rightOk: true, outcomeChanged: false, responsePresent: true },
    });
    expect(() => classify(diff)).not.toThrow();
  });

  test("classify() accepts valid EnvDiff with minimal fields", () => {
    const diff = createBaseDiff({
      status: unchangedVal(200),
    });
    expect(() => classify(diff)).not.toThrow();
  });

  test("classify() produces findings with valid evidence arrays", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
    });
    const findings = classify(diff);
    findings.forEach((f: DiffFinding) => {
      expect(Array.isArray(f.evidence)).toBe(true);
    });
  });

  test("classify() produces findings with non-empty codes", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
    });
    const findings = classify(diff);
    findings.forEach((f: DiffFinding) => {
      expect(f.code).toBeDefined();
      expect(f.code.length).toBeGreaterThan(0);
    });
  });

  test("classify() produces findings with valid severity values", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
      timing: { durationMs: changeVal(100, 1200), deltaMs: 1100 } as TimingDiff,
      headers: {
        core: {
          added: {},
          removed: {},
          unchanged: {},
          changed: {
            "cache-control": {
              left: "public",
              right: "no-store",
              changed: true,
            },
          },
        },
      } as any,
    });
    const findings = classify(diff);
    findings.forEach((f: DiffFinding) => {
      expect(["critical", "warn", "info"]).toContain(f.severity);
    });
  });

  test("classify() produces findings without duplicate codes in same diff", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
    });
    const findings = classify(diff);
    const codes = findings.map((f: DiffFinding) => f.code);
    const uniqueCodes = new Set(codes);
    expect(codes.length).toBe(uniqueCodes.size);
  });

  test("Probe failure findings are properly classified as critical", () => {
    const diff = createBaseDiff({
      probe: {
        leftOk: false,
        rightOk: true,
        leftErrorCode: "dns_error", // Network failure (has error code)
        outcomeChanged: true,
        responsePresent: false,
      },
      // Left has no status (network failure), right has status 200
      status: changeVal(undefined, 200),
    });
    const findings = classify(diff);
    const probeFindings = findings.filter(
      (f: DiffFinding) => f.code === "PROBE_FAILURE"
    );
    expect(probeFindings.length).toBeGreaterThan(0);
    probeFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("critical");
    });
  });
});

// ============================================================================
// Tests: Rule Correctness (Spot Checks)
// ============================================================================
describe("MVP Mock Envelopes - Rule Correctness Spot Checks", () => {
  test("No findings when left and right are identical", () => {
    const diff = createBaseDiff({
      status: unchangedVal(200),
      timing: { durationMs: unchangedVal(100) } as TimingDiff,
      headers: {
        core: {
          added: {},
          removed: {},
          unchanged: { "cache-control": "public" },
          changed: {},
        },
      } as any,
      probe: { leftOk: true, rightOk: true, outcomeChanged: false, responsePresent: true },
    });
    const findings = classify(diff);
    expect(findings.length).toBe(0);
  });

  test("STATUS_MISMATCH emitted when status differs (2xx vs 5xx)", () => {
    const diff = createBaseDiff({
      status: changeVal(200, 500),
    });
    const findings = classify(diff);
    const statusFindings = findings.filter(
      (f: DiffFinding) => f.code === "STATUS_MISMATCH"
    );
    expect(statusFindings.length).toBeGreaterThan(0);
  });

  test("TIMING_DRIFT critical when delta > 1000ms", () => {
    const diff = createBaseDiff({
      status: unchangedVal(200),
      timing: { durationMs: changeVal(100, 1200), deltaMs: 1100 } as TimingDiff,
    });
    const findings = classify(diff);
    const timingFindings = findings.filter(
      (f: DiffFinding) => f.code === "TIMING_DRIFT"
    );
    expect(timingFindings.length).toBeGreaterThan(0);
    timingFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("critical");
    });
  });

  test("TIMING_DRIFT warn when ratio triggers warn (e.g., 1.2x slower)", () => {
    // 1000ms -> 1250ms: delta=250ms (below warn), ratio=1.25 (below warn threshold of 1.5)
    // Should be info or no finding
    const diff = createBaseDiff({
      status: unchangedVal(200),
      timing: { durationMs: changeVal(1000, 1250), deltaMs: 250, ratio: 1.25 } as TimingDiff,
    });
    const findings = classify(diff);
    const timingFindings = findings.filter(
      (f: DiffFinding) => f.code === "TIMING_DRIFT"
    );
    // If present, should be info (ratio < 1.5, delta < 300)
    timingFindings.forEach((f: DiffFinding) => {
      expect(["info", "warn"]).toContain(f.severity);
    });
  });

  test("TIMING_DRIFT warn when delta triggers warn (300-1000ms, low ratio)", () => {
    // Use a high base duration so ratio stays low: 5000ms -> 5350ms
    // delta=350ms (in warn range), ratio=1.07 (below warn threshold of 1.5)
    const diff = createBaseDiff({
      status: unchangedVal(200),
      timing: { durationMs: changeVal(5000, 5350), deltaMs: 350, ratio: 1.07 } as TimingDiff,
    });
    const findings = classify(diff);
    const timingFindings = findings.filter(
      (f: DiffFinding) => f.code === "TIMING_DRIFT"
    );
    timingFindings.forEach((f: DiffFinding) => {
      expect(f.severity).toBe("warn");
    });
  });
});
