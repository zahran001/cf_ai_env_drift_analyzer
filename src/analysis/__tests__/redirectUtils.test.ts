import {
  classifyRedirectChainDrift,
  extractFinalHost,
  chainsAreEqual,
} from "../redirectUtils";

describe("redirectUtils", () => {
  describe("classifyRedirectChainDrift", () => {
    it("should return info with no hop count or final host changes", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com", "http://redirect1.com"],
        ["http://example.com", "http://redirect1.com"]
      );
      expect(result.severity).toBe("info");
      expect(result.hopCountChanged).toBe(false);
      expect(result.finalHostChanged).toBe(false);
    });

    it("should return critical when final host differs (even with hop count diff of 1)", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com", "http://redirect1.com"],
        ["http://example.com", "http://redirect1.com", "http://redirect2.com"]
      );
      expect(result.severity).toBe("critical");
      expect(result.hopCountChanged).toBe(true);
      expect(result.hopCountDiff).toBe(1);
      expect(result.finalHostChanged).toBe(true);
    });

    it("should return critical when hop count differs by 2 or more", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com"],
        ["http://example.com", "http://redirect1.com", "http://redirect2.com"]
      );
      expect(result.severity).toBe("critical");
      expect(result.hopCountDiff).toBe(2);
    });

    it("should return critical when final host differs", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com", "http://final1.com"],
        ["http://example.com", "http://final2.com"]
      );
      expect(result.severity).toBe("critical");
      expect(result.finalHostChanged).toBe(true);
      expect(result.hopCountChanged).toBe(false);
    });

    it("should handle case-insensitive final host comparison", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com", "http://FINAL.COM"],
        ["http://example.com", "http://final.com"]
      );
      expect(result.severity).toBe("info");
      expect(result.finalHostChanged).toBe(false);
    });

    it("should handle empty chains", () => {
      const result = classifyRedirectChainDrift([], []);
      expect(result.severity).toBe("info");
      expect(result.hopCountChanged).toBe(false);
      expect(result.finalHostChanged).toBe(false);
    });

    it("should handle one empty chain", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com"],
        []
      );
      expect(result.severity).toBe("critical");
      expect(result.hopCountDiff).toBe(1);
      expect(result.finalHostChanged).toBe(true);
    });

    it("should handle undefined chains (treated as empty)", () => {
      const result = classifyRedirectChainDrift(undefined, undefined);
      expect(result.severity).toBe("info");
      expect(result.hopCountChanged).toBe(false);
    });

    it("should classify critical when both hop count >= 2 AND final host changes", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com"],
        ["http://example.com", "http://r1.com", "http://final1.com"]
      );
      expect(result.severity).toBe("critical");
      expect(result.hopCountDiff).toBe(2);
      expect(result.finalHostChanged).toBe(true);
    });

    it("should correctly compute hopCountDiff", () => {
      const result = classifyRedirectChainDrift(
        ["url1", "url2", "url3"],
        ["url1", "url2", "url3", "url4", "url5"]
      );
      expect(result.hopCountDiff).toBe(2);
    });

    it("should handle chains with single element", () => {
      const result = classifyRedirectChainDrift(
        ["http://final.com"],
        ["http://final.com"]
      );
      expect(result.severity).toBe("info");
      expect(result.hopCountChanged).toBe(false);
    });

    it("should detect final host change with same hop count", () => {
      const result = classifyRedirectChainDrift(
        ["http://example.com", "http://final1.com"],
        ["http://example.com", "http://final2.com"]
      );
      expect(result.severity).toBe("critical");
      expect(result.hopCountChanged).toBe(false);
      expect(result.finalHostChanged).toBe(true);
    });
  });

  describe("extractFinalHost", () => {
    it("should extract final host from chain", () => {
      const result = extractFinalHost(["http://example.com", "http://redirect.com"]);
      expect(result).toBe("http://redirect.com");
    });

    it("should return single element from single-element chain", () => {
      const result = extractFinalHost(["http://example.com"]);
      expect(result).toBe("http://example.com");
    });

    it("should return undefined for empty chain", () => {
      const result = extractFinalHost([]);
      expect(result).toBeUndefined();
    });

    it("should return undefined for undefined chain", () => {
      const result = extractFinalHost(undefined);
      expect(result).toBeUndefined();
    });

    it("should handle long chains", () => {
      const chain = [
        "http://start.com",
        "http://r1.com",
        "http://r2.com",
        "http://r3.com",
        "http://final.com"
      ];
      const result = extractFinalHost(chain);
      expect(result).toBe("http://final.com");
    });
  });

  describe("chainsAreEqual", () => {
    it("should return true for identical chains", () => {
      const left = ["http://example.com", "http://redirect.com"];
      const right = ["http://example.com", "http://redirect.com"];
      expect(chainsAreEqual(left, right)).toBe(true);
    });

    it("should return false for different chains", () => {
      const left = ["http://example.com", "http://redirect1.com"];
      const right = ["http://example.com", "http://redirect2.com"];
      expect(chainsAreEqual(left, right)).toBe(false);
    });

    it("should be case-insensitive", () => {
      const left = ["HTTP://EXAMPLE.COM", "HTTP://REDIRECT.COM"];
      const right = ["http://example.com", "http://redirect.com"];
      expect(chainsAreEqual(left, right)).toBe(true);
    });

    it("should return false for different lengths", () => {
      const left = ["url1", "url2"];
      const right = ["url1", "url2", "url3"];
      expect(chainsAreEqual(left, right)).toBe(false);
    });

    it("should return true for empty chains", () => {
      expect(chainsAreEqual([], [])).toBe(true);
    });

    it("should handle undefined chains as empty", () => {
      expect(chainsAreEqual(undefined, undefined)).toBe(true);
      expect(chainsAreEqual(undefined, [])).toBe(true);
      expect(chainsAreEqual([], undefined)).toBe(true);
    });

    it("should return false when one is defined and one is empty/undefined", () => {
      expect(chainsAreEqual(["url1"], [])).toBe(false);
      expect(chainsAreEqual(["url1"], undefined)).toBe(false);
    });

    it("should handle single-element chains", () => {
      expect(chainsAreEqual(["http://example.com"], ["http://example.com"])).toBe(true);
      expect(chainsAreEqual(["http://a.com"], ["http://b.com"])).toBe(false);
    });

    it("should handle mixed case URLs correctly", () => {
      const left = ["HTTP://EXAMPLE.COM", "HTTP://MID.COM", "HTTP://FINAL.COM"];
      const right = ["http://example.com", "http://mid.com", "http://final.com"];
      expect(chainsAreEqual(left, right)).toBe(true);
    });
  });
});