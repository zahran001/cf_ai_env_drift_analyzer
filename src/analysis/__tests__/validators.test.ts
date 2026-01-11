import { validateEvidenceKeys } from "../validators";
import type { DiffEvidence } from "@shared/diff";

describe("validateEvidenceKeys", () => {
  // ============================================================
  // 5.1 Valid Evidence (Pass Cases) — 12 tests
  // ============================================================

  describe("Valid Evidence - probe section", () => {
    it("should accept probe with undefined keys", () => {
      const evidence: DiffEvidence[] = [{ section: "probe" }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept probe with [left] key", () => {
      const evidence: DiffEvidence[] = [{ section: "probe", keys: ["left"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept probe with [right] key", () => {
      const evidence: DiffEvidence[] = [{ section: "probe", keys: ["right"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - status section", () => {
    it("should accept status with undefined keys", () => {
      const evidence: DiffEvidence[] = [{ section: "status" }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - finalUrl section", () => {
    it("should accept finalUrl with [scheme] key", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["scheme"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept finalUrl with [host] key", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["host"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept finalUrl with [path] key", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["path"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept finalUrl with [query] key", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["query"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept finalUrl with [finalUrl] key", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["finalUrl"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept finalUrl with sorted multiple keys [host, path]", () => {
      const evidence: DiffEvidence[] = [{ section: "finalUrl", keys: ["host", "path"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - redirects section", () => {
    it("should accept redirects with [hopCount] key", () => {
      const evidence: DiffEvidence[] = [{ section: "redirects", keys: ["hopCount"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept redirects with [chain] key", () => {
      const evidence: DiffEvidence[] = [{ section: "redirects", keys: ["chain"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept redirects with [finalHost] key", () => {
      const evidence: DiffEvidence[] = [{ section: "redirects", keys: ["finalHost"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept redirects with sorted multiple keys [chain, hopCount]", () => {
      const evidence: DiffEvidence[] = [
        { section: "redirects", keys: ["chain", "hopCount"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - headers section", () => {
    it("should accept headers with single lowercase header [cache-control]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["cache-control"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept headers with multiple sorted header names [cache-control, vary]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["cache-control", "vary"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept headers with custom lowercase header [x-custom-header]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["x-custom-header"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept headers with undefined keys", () => {
      const evidence: DiffEvidence[] = [{ section: "headers" }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - content section", () => {
    it("should accept content with [content-type] key", () => {
      const evidence: DiffEvidence[] = [
        { section: "content", keys: ["content-type"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept content with [content-length] key", () => {
      const evidence: DiffEvidence[] = [
        { section: "content", keys: ["content-length"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept content with [body-hash] key", () => {
      const evidence: DiffEvidence[] = [{ section: "content", keys: ["body-hash"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept content with sorted multiple keys [body-hash, content-length]", () => {
      const evidence: DiffEvidence[] = [
        { section: "content", keys: ["body-hash", "content-length"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - timing section", () => {
    it("should accept timing with [duration_ms] key", () => {
      const evidence: DiffEvidence[] = [
        { section: "timing", keys: ["duration_ms"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - cf section", () => {
    it("should accept cf with [colo] key", () => {
      const evidence: DiffEvidence[] = [{ section: "cf", keys: ["colo"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept cf with [asn] key", () => {
      const evidence: DiffEvidence[] = [{ section: "cf", keys: ["asn"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept cf with [country] key", () => {
      const evidence: DiffEvidence[] = [{ section: "cf", keys: ["country"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept cf with sorted multiple keys [asn, country]", () => {
      const evidence: DiffEvidence[] = [{ section: "cf", keys: ["asn", "country"] }];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  describe("Valid Evidence - edge cases", () => {
    it("should accept empty evidence array", () => {
      const evidence: DiffEvidence[] = [];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept multiple evidence items with different sections", () => {
      const evidence: DiffEvidence[] = [
        { section: "probe", keys: ["left"] },
        { section: "headers", keys: ["cache-control"] },
        { section: "content", keys: ["body-hash"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  // ============================================================
  // 5.2 Invalid Section Names (Fail Cases) — 2 tests
  // ============================================================

  describe("Invalid Section Names", () => {
    it("should reject unknown section name", () => {
      const evidence: DiffEvidence[] = [{ section: "unknown_section" as any }];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject typo in section name", () => {
      const evidence: DiffEvidence[] = [{ section: "headers_extra" as any }];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });
  });

  // ============================================================
  // 5.3 Invalid Keys for Section (Fail Cases) — 6 tests
  // ============================================================

  describe("Invalid Keys for Section", () => {
    it("should reject probe with invalid key [center]", () => {
      const evidence: DiffEvidence[] = [{ section: "probe", keys: ["center" as any] }];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject finalUrl with invalid key [fragment]", () => {
      const evidence: DiffEvidence[] = [
        { section: "finalUrl", keys: ["fragment" as any] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject redirects with invalid key [url]", () => {
      const evidence: DiffEvidence[] = [
        { section: "redirects", keys: ["url" as any] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject content with invalid key [mime-type]", () => {
      const evidence: DiffEvidence[] = [
        { section: "content", keys: ["mime-type" as any] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject timing with invalid key [latency_ms]", () => {
      const evidence: DiffEvidence[] = [
        { section: "timing", keys: ["latency_ms" as any] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject cf with invalid key [ip_address]", () => {
      const evidence: DiffEvidence[] = [
        { section: "cf", keys: ["ip_address" as any] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });
  });

  // ============================================================
  // 5.4 Sorting Violations (Fail Cases) — 4 tests
  // ============================================================

  describe("Sorting Violations", () => {
    it("should reject headers with unsorted keys [vary, cache-control]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["vary", "cache-control"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject finalUrl with unsorted keys [query, path]", () => {
      const evidence: DiffEvidence[] = [
        { section: "finalUrl", keys: ["query", "path"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject redirects with unsorted keys [hopCount, finalHost]", () => {
      const evidence: DiffEvidence[] = [
        { section: "redirects", keys: ["hopCount", "finalHost"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject content with unsorted keys [content-type, body-hash]", () => {
      const evidence: DiffEvidence[] = [
        { section: "content", keys: ["content-type", "body-hash"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });
  });

  // ============================================================
  // 5.5 Duplicate Keys (Fail Cases) — 1 test
  // ============================================================

  describe("Duplicate Keys", () => {
    it("should reject duplicate keys in array [cache-control, cache-control]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["cache-control", "cache-control"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });
  });

  // ============================================================
  // 5.6 Case Sensitivity (Fail Cases) — 2 tests
  // ============================================================

  describe("Case Sensitivity - Headers", () => {
    it("should reject header with uppercase [Cache-Control]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["Cache-Control"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });

    it("should reject header with mixed case [Content-Type]", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["Content-Type"] as any },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(false);
    });
  });

  // ============================================================
  // 5.7 Complex Combinations (Pass Cases) — 5 tests
  // ============================================================

  describe("Complex Valid Combinations", () => {
    it("should accept finalUrl with all three components [host, path, query]", () => {
      const evidence: DiffEvidence[] = [
        { section: "finalUrl", keys: ["host", "path", "query"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept content with all three components [body-hash, content-length, content-type]", () => {
      const evidence: DiffEvidence[] = [
        {
          section: "content",
          keys: ["body-hash", "content-length", "content-type"],
        },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept cf with all three components [asn, colo, country]", () => {
      const evidence: DiffEvidence[] = [
        { section: "cf", keys: ["asn", "colo", "country"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept redirects with all three components [chain, finalHost, hopCount]", () => {
      const evidence: DiffEvidence[] = [
        { section: "redirects", keys: ["chain", "finalHost", "hopCount"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should accept headers with many custom header names [cache-control, content-type, x-custom-1, x-custom-2]", () => {
      const evidence: DiffEvidence[] = [
        {
          section: "headers",
          keys: [
            "cache-control",
            "content-type",
            "x-custom-1",
            "x-custom-2",
          ],
        },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  // ============================================================
  // 5.8 Integration Scenarios — 2 tests
  // ============================================================

  describe("Integration Scenarios", () => {
    it("should validate evidence from a realistic status drift finding", () => {
      const evidence: DiffEvidence[] = [
        { section: "status" },
        { section: "headers", keys: ["cache-control"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });

    it("should validate evidence from a realistic cache-control drift finding", () => {
      const evidence: DiffEvidence[] = [
        { section: "probe", keys: ["left"] },
        { section: "headers", keys: ["cache-control", "vary"] },
        { section: "content", keys: ["body-hash"] },
      ];
      expect(validateEvidenceKeys(evidence)).toBe(true);
    });
  });

  // ============================================================
  // Determinism Tests
  // ============================================================

  describe("Determinism", () => {
    it("should return same result for same input (deterministic)", () => {
      const evidence: DiffEvidence[] = [
        { section: "finalUrl", keys: ["host", "path"] },
        { section: "headers", keys: ["cache-control"] },
      ];

      const result1 = validateEvidenceKeys(evidence);
      const result2 = validateEvidenceKeys(evidence);

      expect(result1).toBe(result2);
      expect(result1).toBe(true);
    });

    it("should reject same invalid input consistently", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["vary", "cache-control"] as any },
      ];

      const result1 = validateEvidenceKeys(evidence);
      const result2 = validateEvidenceKeys(evidence);

      expect(result1).toBe(result2);
      expect(result1).toBe(false);
    });
  });
});