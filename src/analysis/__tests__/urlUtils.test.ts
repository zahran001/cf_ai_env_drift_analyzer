import { parseUrlComponents, classifyUrlDrift } from "../urlUtils";

describe("urlUtils", () => {
  describe("parseUrlComponents", () => {
    it("should parse complete URL with all components", () => {
      const url = "https://example.com:8080/path/to/resource?foo=bar#anchor";
      const result = parseUrlComponents(url);
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
      expect(result.path).toBe("/path/to/resource");
      expect(result.query).toBe("?foo=bar");
    });

    it("should normalize scheme and host to lowercase", () => {
      const result = parseUrlComponents("HTTPS://EXAMPLE.COM/Path");
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
      expect(result.path).toBe("/Path");
    });

    it("should handle URL without query string", () => {
      const result = parseUrlComponents("https://example.com/path");
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
      expect(result.path).toBe("/path");
      expect(result.query).toBe("");
    });

    it("should handle invalid URL", () => {
      const result = parseUrlComponents("not a url");
      expect(result.scheme).toBe("invalid");
      expect(result.host).toBeUndefined();
    });

    it("should handle undefined URL", () => {
      const result = parseUrlComponents(undefined);
      expect(result).toEqual({});
    });

    it("should handle empty string URL", () => {
      const result = parseUrlComponents("");
      expect(result).toEqual({});
    });

    it("should preserve path with trailing slash", () => {
      const result = parseUrlComponents("https://example.com/path/");
      expect(result.path).toBe("/path/");
    });

    it("should extract query string including leading ?", () => {
      const result = parseUrlComponents("https://example.com?a=1&b=2");
      expect(result.query).toBe("?a=1&b=2");
    });

    it("should handle port in URL", () => {
      const result = parseUrlComponents("https://example.com:8443/path");
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
      expect(result.path).toBe("/path");
    });

    it("should handle http scheme", () => {
      const result = parseUrlComponents("http://example.com/path");
      expect(result.scheme).toBe("http");
    });
  });

  describe("classifyUrlDrift", () => {
    it("should return info when scheme differs (only)", () => {
      const result = classifyUrlDrift(
        "http://example.com",
        "https://example.com"
      );
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toContain("scheme");
    });

    it("should return critical when host differs", () => {
      const result = classifyUrlDrift(
        "https://example.com",
        "https://other.com"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("host");
    });

    it("should return warn when path differs", () => {
      const result = classifyUrlDrift(
        "https://example.com/a",
        "https://example.com/b"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("path");
      expect(result.diffTypes).not.toContain("scheme");
      expect(result.diffTypes).not.toContain("host");
    });

    it("should return warn when query differs", () => {
      const result = classifyUrlDrift(
        "https://example.com/path?a=1",
        "https://example.com/path?a=2"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("query");
    });

    it("should return info when URLs are identical", () => {
      const result = classifyUrlDrift(
        "https://example.com/path",
        "https://example.com/path"
      );
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toHaveLength(0);
    });

    it("should return critical when both scheme and host differ", () => {
      const result = classifyUrlDrift(
        "http://example.com",
        "https://other.com"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("scheme");
      expect(result.diffTypes).toContain("host");
    });

    it("should return info when scheme differs (host same)", () => {
      const result = classifyUrlDrift(
        "http://example.com/path",
        "https://example.com/path"
      );
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toEqual(["scheme"]);
    });

    it("should return warn when path and query both differ", () => {
      const result = classifyUrlDrift(
        "https://example.com/a?x=1",
        "https://example.com/b?x=2"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("path");
      expect(result.diffTypes).toContain("query");
    });

    it("should handle case-insensitive host comparison", () => {
      const result = classifyUrlDrift(
        "https://EXAMPLE.COM/path",
        "https://example.com/path"
      );
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toHaveLength(0);
    });

    it("should handle one undefined URL", () => {
      const result = classifyUrlDrift(
        "https://example.com/path",
        undefined
      );
      // All components will differ
      expect(result.severity).toBe("critical");
      expect(result.diffTypes.length).toBeGreaterThan(0);
    });

    it("should handle both undefined URLs", () => {
      const result = classifyUrlDrift(undefined, undefined);
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toHaveLength(0);
    });

    it("should handle invalid URLs", () => {
      const result = classifyUrlDrift("not a url", "also not a url");
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toHaveLength(0);
    });

    it("should return warn when only one URL is invalid", () => {
      const result = classifyUrlDrift(
        "https://example.com/path",
        "not a url"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("scheme");
    });

    it("should return warn when scheme and path both differ (but not host)", () => {
      const result = classifyUrlDrift(
        "http://example.com/a",
        "https://example.com/b"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("scheme");
      expect(result.diffTypes).toContain("path");
      expect(result.diffTypes).not.toContain("host");
    });

    it("should return warn when scheme and query both differ (but not host)", () => {
      const result = classifyUrlDrift(
        "http://example.com/path?x=1",
        "https://example.com/path?x=2"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("scheme");
      expect(result.diffTypes).toContain("query");
      expect(result.diffTypes).not.toContain("host");
    });

    it("should return critical when scheme differs along with host", () => {
      const result = classifyUrlDrift(
        "http://example.com",
        "https://other.com"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("scheme");
      expect(result.diffTypes).toContain("host");
    });
  });
});