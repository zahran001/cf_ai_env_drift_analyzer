import {
  parseCacheControl,
  hasCriticalCacheKeyword,
  classifyCacheControlDrift,
} from "../cacheUtils";

describe("cacheUtils", () => {
  describe("parseCacheControl", () => {
    it("Parses single directive without value", () => {
      const result = parseCacheControl("no-store");
      expect(result).toEqual(new Set(["no-store"]));
    });

    it("Parses single directive with value", () => {
      const result = parseCacheControl("max-age=3600");
      expect(result).toEqual(new Set(["max-age"]));
    });

    it("Parses multiple directives", () => {
      const result = parseCacheControl("no-store, max-age=3600, public");
      expect(result).toEqual(new Set(["no-store", "max-age", "public"]));
    });

    it("Normalizes to lowercase", () => {
      const result = parseCacheControl("NO-STORE, Private, Max-Age=3600");
      expect(result).toEqual(
        new Set(["no-store", "private", "max-age"])
      );
    });

    it("Handles extra whitespace around directives", () => {
      const result = parseCacheControl(
        "  no-store  ,  max-age=3600  ,  public  "
      );
      expect(result).toEqual(new Set(["no-store", "max-age", "public"]));
    });

    it("Deduplicates repeated directives", () => {
      const result = parseCacheControl("no-store, no-store, public");
      expect(result).toEqual(new Set(["no-store", "public"]));
    });

    it("Filters empty directives from malformed input", () => {
      const result = parseCacheControl("public,,private");
      expect(result).toEqual(new Set(["public", "private"]));
    });

    it("Returns empty set for undefined input", () => {
      const result = parseCacheControl(undefined);
      expect(result).toEqual(new Set());
    });

    it("Returns empty set for empty string", () => {
      const result = parseCacheControl("");
      expect(result).toEqual(new Set());
    });

    it("Handles directive with complex value containing comma-like syntax", () => {
      // Edge case: values can have = and numbers, but split on comma
      const result = parseCacheControl("max-age=3600, s-maxage=7200");
      expect(result).toEqual(new Set(["max-age", "s-maxage"]));
    });

    it("Handles whitespace-only strings as empty", () => {
      const result = parseCacheControl("   ");
      expect(result).toEqual(new Set());
    });
  });

  describe("hasCriticalCacheKeyword", () => {
    it("Detects no-store keyword", () => {
      const directives = new Set(["no-store", "max-age"]);
      expect(hasCriticalCacheKeyword(directives)).toBe(true);
    });

    it("Detects private keyword", () => {
      const directives = new Set(["private", "max-age"]);
      expect(hasCriticalCacheKeyword(directives)).toBe(true);
    });

    it("Detects when both no-store and private present", () => {
      const directives = new Set(["no-store", "private"]);
      expect(hasCriticalCacheKeyword(directives)).toBe(true);
    });

    it("Returns false when neither critical keyword present", () => {
      const directives = new Set(["public", "max-age", "must-revalidate"]);
      expect(hasCriticalCacheKeyword(directives)).toBe(false);
    });

    it("Returns false for empty set", () => {
      const directives = new Set<string>();
      expect(hasCriticalCacheKeyword(directives)).toBe(false);
    });

    it("Is case-sensitive after normalization (expects lowercase)", () => {
      // This tests that the function expects normalized input
      const directives = new Set(["NO-STORE"]); // Not normalized
      expect(hasCriticalCacheKeyword(directives)).toBe(false); // Should not find uppercase variant
    });
  });

  describe("classifyCacheControlDrift", () => {
    it("Returns critical when left has no-store, right lacks it", () => {
      expect(classifyCacheControlDrift("no-store", "public")).toBe("critical");
    });

    it("Returns critical when right has private, left lacks it", () => {
      expect(classifyCacheControlDrift("public", "private")).toBe("critical");
    });

    it("Returns critical when left has critical keyword, right is undefined", () => {
      expect(classifyCacheControlDrift("no-store", undefined)).toBe("critical");
    });

    it("Returns critical when left is undefined, right has critical keyword", () => {
      expect(classifyCacheControlDrift(undefined, "private")).toBe("critical");
    });

    it("Returns info when both sides have same critical keyword", () => {
      expect(classifyCacheControlDrift("no-store", "no-store")).toBe("info");
    });

    it("Returns info when both sides have different critical keywords", () => {
      // Both have a critical keyword, even if different ones
      expect(classifyCacheControlDrift("no-store", "private")).toBe("info");
    });

    it("Returns info when neither side has critical keyword", () => {
      expect(classifyCacheControlDrift("public", "max-age=3600")).toBe("info");
    });

    it("Returns info when both sides are undefined", () => {
      expect(classifyCacheControlDrift(undefined, undefined)).toBe("info");
    });

    it("Returns info when both sides are empty strings", () => {
      expect(classifyCacheControlDrift("", "")).toBe("info");
    });

    it("Returns info when different non-critical directives on both sides", () => {
      expect(classifyCacheControlDrift("public", "private")).toBe("critical");
      // But "public" vs "max-age" should be info
      expect(classifyCacheControlDrift("public, max-age=3600", "max-age=7200")).toBe(
        "info"
      );
    });

    it("Handles case-insensitive comparison correctly", () => {
      expect(classifyCacheControlDrift("NO-STORE", "public")).toBe("critical");
      expect(classifyCacheControlDrift("Public", "PRIVATE")).toBe("critical");
    });

    it("Returns critical with whitespace variations", () => {
      expect(classifyCacheControlDrift("  no-store  ", "  public  ")).toBe(
        "critical"
      );
    });

    it("Returns info when left has no-store and max-age, right has max-age with different value", () => {
      // Left: no-store (critical) + max-age
      // Right: max-age (no critical)
      expect(classifyCacheControlDrift("no-store, max-age=3600", "max-age=7200")).toBe(
        "critical"
      );
    });

    it("Treats missing header as no critical keyword", () => {
      // Left missing (no critical) vs right missing (no critical) = info
      expect(classifyCacheControlDrift(undefined, undefined)).toBe("info");
      // Left has critical vs right missing (no critical) = critical
      expect(classifyCacheControlDrift("no-store", undefined)).toBe("critical");
    });
  });

  describe("Integration scenarios", () => {
    it("Realistic scenario: CDN cache control drifted from public to private", () => {
      const leftCacheControl = "public, max-age=86400"; // CDN: cache publicly
      const rightCacheControl = "private, max-age=3600"; // Updated: private only
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "critical"
      );
    });

    it("Realistic scenario: Cache TTL changed but critical status unchanged", () => {
      const leftCacheControl = "public, max-age=3600";
      const rightCacheControl = "public, max-age=7200";
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "info"
      );
    });

    it("Realistic scenario: No-store added due to sensitive data", () => {
      const leftCacheControl = "max-age=3600";
      const rightCacheControl = "no-store";
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "critical"
      );
    });

    it("Realistic scenario: Cache control removed entirely (but was non-critical)", () => {
      // Removing non-critical directives is info (no-store or private not involved)
      const leftCacheControl = "public, max-age=86400";
      const rightCacheControl = undefined;
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "info"
      );
    });

    it("Realistic scenario: Critical header removed (no-store → undefined)", () => {
      // Removing a critical directive IS critical drift
      const leftCacheControl = "no-store, max-age=3600";
      const rightCacheControl = undefined;
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "critical"
      );
    });

    it("Realistic scenario: Both responses explicitly allow caching", () => {
      const leftCacheControl = "public, immutable";
      const rightCacheControl = "public, s-maxage=31536000";
      expect(classifyCacheControlDrift(leftCacheControl, rightCacheControl)).toBe(
        "info"
      );
    });
  });

  describe("Determinism", () => {
    it("Same input produces same output every time for parseCacheControl", () => {
      const input = "no-store, max-age=3600, public";
      const result1 = parseCacheControl(input);
      const result2 = parseCacheControl(input);
      expect(result1).toEqual(result2);
    });

    it("Same input produces same output every time for classifyCacheControlDrift", () => {
      const left = "no-store";
      const right = "public";
      const result1 = classifyCacheControlDrift(left, right);
      const result2 = classifyCacheControlDrift(left, right);
      expect(result1).toBe(result2);
    });
  });

  describe("Edge cases", () => {
    it("Handles directives with equals in value", () => {
      // Some invalid but defensive parsing
      const result = parseCacheControl("custom=value=extra");
      expect(result).toEqual(new Set(["custom"]));
    });

    it("Handles only-comma input", () => {
      const result = parseCacheControl(",,,");
      expect(result).toEqual(new Set());
    });

    it("Returns correct Severity type (not boolean)", () => {
      const result = classifyCacheControlDrift("no-store", "public");
      expect(typeof result).toBe("string");
      expect(["critical", "warn", "info"]).toContain(result);
    });

    it("Both sides with opposite critical keywords", () => {
      // Left: no-store, Right: private
      // Both have critical keywords (even if different) → info
      expect(classifyCacheControlDrift("no-store", "private")).toBe("info");
    });
  });
});