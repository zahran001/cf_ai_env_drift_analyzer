import {
  computeDedupKey,
  deduplicateFindings,
  sortFindings,
  computeMaxSeverity,
} from "@shared/diff";
import type { DiffFinding } from "@shared/diff";

describe("diff helpers", () => {
  describe("computeDedupKey", () => {
    it("should compute key from code, section, and sorted keys", () => {
      const finding: DiffFinding = {
        id: "test-1",
        code: "STATUS_MISMATCH",
        category: "routing",
        severity: "critical",
        message: "Status differs",
        evidence: [{ section: "status", keys: ["status"] }],
      };

      const key = computeDedupKey(finding);
      expect(key).toBe("STATUS_MISMATCH:status:status");
    });

    it("should sort evidence keys in key", () => {
      const finding: DiffFinding = {
        id: "test-1",
        code: "CORS_HEADER_DRIFT",
        category: "security",
        severity: "warn",
        message: "CORS headers differ",
        evidence: [
          {
            section: "headers",
            keys: ["access-control-allow-origin", "access-control-allow-methods"],
          },
        ],
      };

      const key = computeDedupKey(finding);
      expect(key).toBe(
        "CORS_HEADER_DRIFT:headers:access-control-allow-methods,access-control-allow-origin"
      );
    });

    it("should handle missing evidence", () => {
      const finding: DiffFinding = {
        id: "test-1",
        code: "UNKNOWN_DRIFT",
        category: "unknown",
        severity: "info",
        message: "Unknown drift",
      };

      const key = computeDedupKey(finding);
      expect(key).toBe("UNKNOWN_DRIFT:undefined:");
    });

    it("should flatten keys from multiple evidence entries but use only first section", () => {
      const finding: any = {
        id: "test-1",
        code: "CACHE_HEADER_DRIFT",
        category: "routing",
        severity: "warn",
        message: "Multiple evidence sections",
        evidence: [
          { section: "headers", keys: ["cache-control", "vary"] },
          { section: "status", keys: ["status"] },
        ],
      };

      const key = computeDedupKey(finding);
      // Section should be from first entry ("headers")
      // Keys should be flattened and sorted from all entries
      expect(key).toBe("CACHE_HEADER_DRIFT:headers:cache-control,status,vary");
    });

    it("should be order-insensitive for keys (normalized by sorting)", () => {
      const findingA: DiffFinding = {
        id: "A",
        code: "CACHE_HEADER_DRIFT",
        category: "cache",
        severity: "warn",
        message: "m",
        evidence: [{ section: "headers", keys: ["z", "a", "m"] }],
      };

      const findingB: DiffFinding = {
        id: "B",
        code: "CACHE_HEADER_DRIFT",
        category: "cache",
        severity: "warn",
        message: "m",
        evidence: [{ section: "headers", keys: ["a", "m", "z"] }],
      };

      const keyA = computeDedupKey(findingA);
      const keyB = computeDedupKey(findingB);

      // Keys in different order should produce same dedup key
      expect(keyA).toBe(keyB);
      expect(keyA).toBe("CACHE_HEADER_DRIFT:headers:a,m,z");
    });

    it("should include section in key to differentiate same code/keys with different sections", () => {
      const findingA: DiffFinding = {
        id: "A",
        code: "UNKNOWN_DRIFT",
        category: "unknown",
        severity: "info",
        message: "m",
        evidence: [{ section: "headers", keys: ["x"] }],
      };

      const findingB: DiffFinding = {
        id: "B",
        code: "UNKNOWN_DRIFT",
        category: "unknown",
        severity: "info",
        message: "m",
        evidence: [{ section: "status", keys: ["x"] }],
      };

      const keyA = computeDedupKey(findingA);
      const keyB = computeDedupKey(findingB);

      // Different sections should produce different keys
      expect(keyA).not.toBe(keyB);
      expect(keyA).toBe("UNKNOWN_DRIFT:headers:x");
      expect(keyB).toBe("UNKNOWN_DRIFT:status:x");
    });
  });

  describe("deduplicateFindings", () => {
    it("should deduplicate by (code, section, sorted keys)", () => {
      const findings: DiffFinding[] = [
        {
          id: "A",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "Status differs",
          evidence: [{ section: "status" }],
        },
        {
          id: "B",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "Status differs",
          evidence: [{ section: "status" }],
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].id).toBe("A"); // First occurrence kept
    });

    it("should keep different findings", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "Status differs",
          evidence: [{ section: "status" }],
        },
        {
          id: "2",
          code: "FINAL_URL_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "Final URL differs",
          evidence: [{ section: "finalUrl" }],
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped).toHaveLength(2);
    });

    it("should preserve insertion order for unique findings", () => {
      const findings: DiffFinding[] = [
        {
          id: "info-1",
          code: "TIMING_DRIFT",
          category: "timing",
          severity: "info",
          message: "Timing differs",
          evidence: [{ section: "timing" }],
        },
        {
          id: "warn-1",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "Cache header differs",
          evidence: [{ section: "headers" }],
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped[0].id).toBe("info-1");
      expect(deduped[1].id).toBe("warn-1");
    });

    it("should deduplicate keys that differ only in order", () => {
      const findings: DiffFinding[] = [
        {
          id: "A",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "m",
          evidence: [
            { section: "headers", keys: ["cache-control", "vary", "max-age"] },
          ],
        },
        {
          id: "B",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "m",
          evidence: [
            { section: "headers", keys: ["max-age", "cache-control", "vary"] },
          ],
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].id).toBe("A"); // First occurrence kept
    });

    it("should NOT deduplicate same code/keys but different section", () => {
      const findings: any[] = [
        {
          id: "A",
          code: "UNKNOWN_DRIFT",
          category: "unknown",
          severity: "info",
          message: "m",
          evidence: [{ section: "headers", keys: ["x"] }],
        },
        {
          id: "B",
          code: "UNKNOWN_DRIFT",
          category: "unknown",
          severity: "info",
          message: "m",
          evidence: [{ section: "status", keys: ["x"] }],
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped).toHaveLength(2);
      expect(deduped[0].id).toBe("A");
      expect(deduped[1].id).toBe("B");
    });
  });

  describe("sortFindings", () => {
    it("should sort by severity DESC (critical > warn > info)", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "UNKNOWN_DRIFT",
          category: "unknown",
          severity: "info",
          message: "z",
        },
        {
          id: "2",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "x",
        },
        {
          id: "3",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "y",
        },
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0].severity).toBe("critical");
      expect(sorted[1].severity).toBe("warn");
      expect(sorted[2].severity).toBe("info");
    });

    it("should sort by code ASC within same severity", () => {
      const findings: any[] = [
        {
          id: "1",
          code: "TIMING_DRIFT",
          category: "routing",
          severity: "warn",
          message: "a",
        },
        {
          id: "2",
          code: "AUTH_CHALLENGE_PRESENT",
          category: "routing",
          severity: "warn",
          message: "z",
        },
        {
          id: "3",
          code: "CACHE_HEADER_DRIFT",
          category: "routing",
          severity: "warn",
          message: "m",
        },
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0].code).toBe("AUTH_CHALLENGE_PRESENT");
      expect(sorted[1].code).toBe("CACHE_HEADER_DRIFT");
      expect(sorted[2].code).toBe("TIMING_DRIFT");
    });

    it("should sort by message ASC within same severity and code", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "zebra",
        },
        {
          id: "2",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "apple",
        },
        {
          id: "3",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "monkey",
        },
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0].message).toBe("apple");
      expect(sorted[1].message).toBe("monkey");
      expect(sorted[2].message).toBe("zebra");
    });

    it("should handle complex sorting (severity → code → message)", () => {
      const findings: any[] = [
        {
          id: "1",
          code: "TIMING_DRIFT",
          category: "routing",
          severity: "info",
          message: "zzz",
        },
        {
          id: "2",
          code: "CONTENT_TYPE_DRIFT",
          category: "routing",
          severity: "critical",
          message: "aaa",
        },
        {
          id: "3",
          code: "AUTH_CHALLENGE_PRESENT",
          category: "routing",
          severity: "warn",
          message: "bbb",
        },
        {
          id: "4",
          code: "AUTH_CHALLENGE_PRESENT",
          category: "routing",
          severity: "critical",
          message: "ccc",
        },
      ];

      const sorted = sortFindings(findings);
      // Critical first, then by code
      expect(sorted[0].code).toBe("AUTH_CHALLENGE_PRESENT");
      expect(sorted[0].severity).toBe("critical");
      expect(sorted[1].code).toBe("CONTENT_TYPE_DRIFT");
      expect(sorted[1].severity).toBe("critical");
      // Then warn
      expect(sorted[2].severity).toBe("warn");
      // Then info
      expect(sorted[3].severity).toBe("info");
    });
  });

  describe("computeMaxSeverity", () => {
    it("should return 'critical' if any finding is critical", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "STATUS_MISMATCH",
          category: "routing",
          severity: "info",
          message: "m",
        },
        {
          id: "2",
          code: "FINAL_URL_MISMATCH",
          category: "routing",
          severity: "critical",
          message: "m",
        },
        {
          id: "3",
          code: "TIMING_DRIFT",
          category: "timing",
          severity: "warn",
          message: "m",
        },
      ];

      expect(computeMaxSeverity(findings)).toBe("critical");
    });

    it("should return 'warn' if no critical but any warn", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "TIMING_DRIFT",
          category: "timing",
          severity: "info",
          message: "m",
        },
        {
          id: "2",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "m",
        },
      ];

      expect(computeMaxSeverity(findings)).toBe("warn");
    });

    it("should return 'info' if all findings are info", () => {
      const findings: DiffFinding[] = [
        {
          id: "1",
          code: "TIMING_DRIFT",
          category: "timing",
          severity: "info",
          message: "m",
        },
        {
          id: "2",
          code: "CF_CONTEXT_DRIFT",
          category: "platform",
          severity: "info",
          message: "m",
        },
      ];

      expect(computeMaxSeverity(findings)).toBe("info");
    });

    it("should return 'info' for empty findings array", () => {
      expect(computeMaxSeverity([])).toBe("info");
    });
  });
});
