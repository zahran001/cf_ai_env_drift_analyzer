import { classify } from "../classify";
import type { EnvDiff, Change } from "@shared/diff";
import type { RedirectHop } from "@shared/signal";

const change = <T>(left: T | undefined, right: T | undefined): Change<T> => ({
  left,
  right,
  changed: left !== right,
});

const unchanged = <T>(value: T): Change<T> => ({
  left: value,
  right: value,
  changed: false,
});

function createBaseDiff(overrides: any = {}): EnvDiff {
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

function createEnvDiffWithRedirects(options: {
  leftRedirects?: RedirectHop[];
  rightRedirects?: RedirectHop[];
} = {}): EnvDiff {
  const leftRedirects = options.leftRedirects || [];
  const rightRedirects = options.rightRedirects || [];

  return createBaseDiff({
    redirects: {
      left: leftRedirects,
      right: rightRedirects,
      hopCount: {
        left: leftRedirects.length,
        right: rightRedirects.length,
        changed: leftRedirects.length !== rightRedirects.length,
      },
      chainChanged: leftRedirects.some((h, i) => h.toUrl !== rightRedirects[i]?.toUrl),
    },
  });
}

describe("classify", () => {
  describe("Probe Failures", () => {
    // Network failures (no response, only error code)
    it("should emit PROBE_FAILURE when both probes had network failures (DNS/timeout)", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: false,
          rightOk: false,
          leftErrorCode: "dns_error",
          rightErrorCode: "dns_error",
          outcomeChanged: false,
        },
        // No status field when network failure (no HTTP response)
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("PROBE_FAILURE");
      expect(findings[0].severity).toBe("critical");
      expect(findings[0].message).toContain("network-level");
    });

    it("should emit PROBE_FAILURE when left probe had network failure, right succeeded", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: false,
          rightOk: true,
          leftErrorCode: "timeout",
          outcomeChanged: true,
        },
        // Left has no status (network failure), right has status
        status: change(undefined, 200),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("PROBE_FAILURE");
      expect(findings[0].message).toContain("network-level");
    });

    it("should emit PROBE_FAILURE when right probe had network failure, left succeeded", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: true,
          rightOk: false,
          rightErrorCode: "tls_error",
          outcomeChanged: true,
        },
        // Left has status, right has no status (network failure)
        status: change(200, undefined),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain("network-level");
    });

    it("should not emit PROBE_FAILURE when both had HTTP errors (200 vs 404)", () => {
      // Both responses exist (have status codes), even though right has ok: false
      const diff = createBaseDiff({
        probe: {
          leftOk: true,
          rightOk: false,
          outcomeChanged: true,
        },
        status: change(200, 404),
      });
      const findings = classify(diff);
      // Should emit STATUS_MISMATCH, not PROBE_FAILURE
      expect(findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);
      expect(findings.some((f) => f.code === "STATUS_MISMATCH")).toBe(true);
    });

    it("should not emit findings when both probes succeeded (200 vs 200)", () => {
      const diff = createBaseDiff({
        probe: { leftOk: true, rightOk: true, outcomeChanged: false },
        status: unchanged(200),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(0);
    });
  });

  describe("Status Mismatch", () => {
    it("should emit with critical severity (2xx vs 5xx)", () => {
      const diff = createBaseDiff({
        status: change(200, 500),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("STATUS_MISMATCH");
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with critical severity (3xx vs 2xx)", () => {
      const diff = createBaseDiff({
        status: change(301, 200),
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with warn severity (200 vs 201)", () => {
      const diff = createBaseDiff({
        status: change(200, 201),
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });

    it("should not emit when status unchanged", () => {
      const diff = createBaseDiff({
        status: unchanged(200),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(0);
    });

    // Test cases for HTTP error responses (4xx/5xx)
    // These have ok: false but still have status codes (not network failures)
    it("should emit STATUS_MISMATCH for 200 vs 404 (both have responses)", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: true,
          rightOk: false,
          outcomeChanged: true,
        },
        status: change(200, 404),
      });
      const findings = classify(diff);
      const statusMismatch = findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch?.severity).toBe("critical");
    });

    it("should emit STATUS_MISMATCH for 200 vs 500", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: true,
          rightOk: false,
          outcomeChanged: true,
        },
        status: change(200, 500),
      });
      const findings = classify(diff);
      const statusMismatch = findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch?.severity).toBe("critical");
    });

    it("should emit STATUS_MISMATCH for 404 vs 500 (both error codes, severity warn)", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: false,
          rightOk: false,
          outcomeChanged: true,
        },
        status: change(404, 500),
      });
      const findings = classify(diff);
      const statusMismatch = findings.find((f) => f.code === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      // Both are 4xx/5xx, so severity is "warn" not "critical"
      expect(statusMismatch?.severity).toBe("warn");
    });

    it("should not emit PROBE_FAILURE for HTTP errors (only STATUS_MISMATCH)", () => {
      const diff = createBaseDiff({
        probe: {
          leftOk: true,
          rightOk: false,
          outcomeChanged: true,
        },
        status: change(200, 404),
      });
      const findings = classify(diff);
      expect(findings.some((f) => f.code === "PROBE_FAILURE")).toBe(false);
    });
  });

  describe("Final URL Mismatch", () => {
    it("should emit with critical severity (host differs)", () => {
      const diff = createBaseDiff({
        finalUrl: change("https://example.com/path", "https://different.com/path"),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("FINAL_URL_MISMATCH");
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with info severity (scheme differs only)", () => {
      const diff = createBaseDiff({
        finalUrl: change("http://example.com", "https://example.com"),
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("info");
    });

    it("should emit with warn severity (path differs)", () => {
      const diff = createBaseDiff({
        finalUrl: change("https://example.com/a", "https://example.com/b"),
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });
  });

  describe("Redirect Chain Changed", () => {
    it("should emit with warn severity when hopCount differs by >=2", () => {
      const diff = createBaseDiff({
        redirects: {
          left: [{ toUrl: "http://final.com", status: 301 }],
          right: [
            { toUrl: "http://mid1.com", status: 301 },
            { toUrl: "http://mid2.com", status: 301 },
            { toUrl: "http://final.com", status: 301 },
          ],
          hopCount: change(1, 3),
          chainChanged: true,
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("REDIRECT_CHAIN_CHANGED");
      expect(findings[0].severity).toBe("warn");
    });
  });

  describe("Auth Challenge", () => {
    it("should emit with critical severity (header on one side only)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            added: { "www-authenticate": "Bearer" },
            removed: {},
            changed: {},
            unchanged: {},
          } as any,
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("AUTH_CHALLENGE_PRESENT");
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with warn severity (header on both but differs)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            changed: {
              "www-authenticate": change("Bearer", "Basic"),
            },
            added: {},
            removed: {},
            unchanged: {},
          } as any,
        },
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });
  });

  describe("CORS Header Drift", () => {
    it("should emit with critical severity (allow-origin differs)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            added: {},
            removed: {},
            changed: {},
            unchanged: {},
          } as any,
          accessControl: {
            changed: {
              "access-control-allow-origin": change("*", "https://example.com"),
            },
            added: {},
            removed: {},
            unchanged: {},
          } as any,
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("CORS_HEADER_DRIFT");
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with warn severity (other access-control headers)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            added: {},
            removed: {},
            changed: {},
            unchanged: {},
          } as any,
          accessControl: {
            added: { "access-control-allow-credentials": "true" },
            removed: {},
            changed: {},
            unchanged: {},
          } as any,
        },
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });
  });

  describe("Cache Header Drift", () => {
    it("should emit with critical severity (no-store added)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            changed: {
              "cache-control": change("max-age=3600", "no-store"),
            },
            added: {},
            removed: {},
            unchanged: {},
          } as any,
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("CACHE_HEADER_DRIFT");
      expect(findings[0].severity).toBe("critical");
    });
  });

  describe("Content-Type Drift", () => {
    it("should emit with critical severity (text/html vs application/json)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            changed: {
              "content-type": change("text/html; charset=utf-8", "application/json"),
            },
            added: {},
            removed: {},
            unchanged: {},
          } as any,
        },
        content: {
          contentType: change("text/html; charset=utf-8", "application/json"),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("CONTENT_TYPE_DRIFT");
      expect(findings[0].severity).toBe("critical");
    });

    it("should normalize Content-Type (ignore charset)", () => {
      const diff = createBaseDiff({
        headers: {
          core: {
            unchanged: { "content-type": "text/html; charset=utf-8" },
            added: {},
            removed: {},
            changed: {},
          } as any,
        },
        content: {
          contentType: unchanged("text/html; charset=utf-8"),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(0);
    });
  });

  describe("Body Hash Drift", () => {
    it("should emit when hash differs, status and content-type unchanged", () => {
      const diff = createBaseDiff({
        status: unchanged(200),
        headers: {
          core: {
            unchanged: { "content-type": "text/html" },
            added: {},
            removed: {},
            changed: {},
          } as any,
        },
        content: {
          bodyHash: change("abc123", "def456"),
          contentType: unchanged("text/html"),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("BODY_HASH_DRIFT");
      expect(findings[0].severity).toBe("critical");
    });

    it("should not emit when status changed", () => {
      const diff = createBaseDiff({
        status: change(200, 500),
        headers: {
          core: {
            unchanged: { "content-type": "text/html" },
            added: {},
            removed: {},
            changed: {},
          } as any,
        },
        content: {
          bodyHash: change("abc123", "def456"),
          contentType: unchanged("text/html"),
        },
      });
      const findings = classify(diff);
      const bodyHashFinding = findings.find((f) => f.code === "BODY_HASH_DRIFT");
      expect(bodyHashFinding).toBeUndefined();
    });
  });

  describe("Content-Length Drift", () => {
    it("should emit with info severity (delta < 200B)", () => {
      const diff = createBaseDiff({
        content: {
          contentLength: change(1000, 1050),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("CONTENT_LENGTH_DRIFT");
      expect(findings[0].severity).toBe("info");
    });

    it("should emit with warn severity (200B <= delta < 2000B)", () => {
      const diff = createBaseDiff({
        content: {
          contentLength: change(1000, 1500),
        },
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });

    it("should emit with critical severity (delta >= 2000B, status same)", () => {
      const diff = createBaseDiff({
        status: unchanged(200),
        content: {
          contentLength: change(1000, 3500),
        },
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("critical");
    });
  });

  describe("Timing Drift", () => {
    it("should emit with critical severity (high ratio)", () => {
      const diff = createBaseDiff({
        timing: {
          durationMs: change(100, 300),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("TIMING_DRIFT");
      expect(findings[0].severity).toBe("critical");
    });

    it("should emit with warn severity (moderate ratio)", () => {
      const diff = createBaseDiff({
        timing: {
          durationMs: change(100, 200),
        },
      });
      const findings = classify(diff);
      expect(findings[0].severity).toBe("warn");
    });

    it("should not emit when max duration < 50ms", () => {
      const diff = createBaseDiff({
        timing: {
          durationMs: change(10, 20),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(0);
    });
  });

  describe("CF Context Drift", () => {
    it("should emit with info severity (no timing drift)", () => {
      const diff = createBaseDiff({
        cf: {
          colo: change("LAX", "SFO"),
        },
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("CF_CONTEXT_DRIFT");
      expect(findings[0].severity).toBe("info");
    });

    it("should emit with warn severity (timing drift present)", () => {
      const diff = createBaseDiff({
        timing: {
          durationMs: change(100, 300),
        },
        cf: {
          colo: change("LAX", "SFO"),
        },
      });
      const findings = classify(diff);
      const cfFinding = findings.find((f) => f.code === "CF_CONTEXT_DRIFT");
      expect(cfFinding?.severity).toBe("warn");
    });
  });

  describe("Post-Processing & Determinism", () => {
    it("should be deterministic (same input produces same output)", () => {
      const baseOverrides = {
        status: change(200, 500),
      };
      const diff1 = createBaseDiff(baseOverrides);
      const diff2 = createBaseDiff(baseOverrides);
      const findings1 = classify(diff1);
      const findings2 = classify(diff2);
      expect(JSON.stringify(findings1)).toBe(JSON.stringify(findings2));
    });

    it("should return empty array when no rules triggered", () => {
      const diff = createBaseDiff({
        status: unchanged(200),
        finalUrl: unchanged("https://example.com"),
      });
      const findings = classify(diff);
      expect(findings).toHaveLength(0);
    });

    it("should include valid finding IDs", () => {
      const diff = createBaseDiff({
        status: change(200, 500),
      });
      const findings = classify(diff);
      expect(findings[0].id).toBeTruthy();
    });

    it("should preserve left_value and right_value", () => {
      const diff = createBaseDiff({
        status: change(200, 500),
      });
      const findings = classify(diff);
      expect(findings[0].left_value).toBe(200);
      expect(findings[0].right_value).toBe(500);
    });

    it("should handle complex multi-rule scenario", () => {
      const diff = createBaseDiff({
        status: change(200, 201),
        finalUrl: change("https://example.com/a", "https://example.com/b"),
        timing: {
          durationMs: change(100, 300),
        },
      });
      const findings = classify(diff);
      expect(findings.length).toBeGreaterThan(0);
      const codes = findings.map((f) => f.code);
      expect(codes).toContain("STATUS_MISMATCH");
      expect(codes).toContain("FINAL_URL_MISMATCH");
      expect(codes).toContain("TIMING_DRIFT");
    });
  });

  describe("Redirect Chain Drift", () => {
    it("should emit REDIRECT_CHAIN_CHANGED with warn severity when hopCount differs by 1", () => {
      const diff = createEnvDiffWithRedirects({
        leftRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://example.com/final", status: 301 },
        ],
        rightRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://example.com/mid", status: 301 },
          { fromUrl: "http://example.com/mid", toUrl: "http://example.com/final", status: 302 },
        ],
      });

      const findings = classify(diff);

      const redirectFinding = findings.find((f) => f.code === "REDIRECT_CHAIN_CHANGED");
      expect(redirectFinding).toBeDefined();
      expect(redirectFinding?.severity).toBe("warn");
      expect(redirectFinding?.category).toBe("routing");
      expect(redirectFinding?.message).toBe("Redirect chain differs");
    });

    it("should emit REDIRECT_CHAIN_CHANGED with warn severity when hopCount differs by 2+", () => {
      const diff = createEnvDiffWithRedirects({
        leftRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://example.com/final", status: 301 },
        ],
        rightRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://example.com/a", status: 301 },
          { fromUrl: "http://example.com/a", toUrl: "http://example.com/b", status: 302 },
          { fromUrl: "http://example.com/b", toUrl: "http://example.com/final", status: 302 },
        ],
      });

      const findings = classify(diff);

      const redirectFinding = findings.find((f) => f.code === "REDIRECT_CHAIN_CHANGED");
      expect(redirectFinding).toBeDefined();
      expect(redirectFinding?.severity).toBe("warn");
      expect(redirectFinding?.category).toBe("routing");
      expect(redirectFinding?.message).toBe("Redirect chain differs");
    });

    it("should emit REDIRECT_CHAIN_CHANGED with critical severity when final host differs", () => {
      const diff = createEnvDiffWithRedirects({
        leftRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://left-cdn.com/final", status: 301 },
        ],
        rightRedirects: [
          { fromUrl: "http://example.com", toUrl: "http://right-cdn.com/final", status: 301 },
        ],
      });

      const findings = classify(diff);

      const redirectFinding = findings.find((f) => f.code === "REDIRECT_CHAIN_CHANGED");
      expect(redirectFinding).toBeDefined();
      expect(redirectFinding?.severity).toBe("critical");
      expect(redirectFinding?.category).toBe("routing");
      expect(redirectFinding?.message).toBe("Redirect chain differs");
    });
  });
});
