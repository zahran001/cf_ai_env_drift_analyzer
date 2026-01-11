/**
 * Tests for headerDiff.ts
 *
 * Validates:
 * 1. Whitelist enforcement (only allowed headers captured)
 * 2. Case-insensitive key matching and normalization
 * 3. Separation of core headers and access-control headers
 * 4. Correct classification of headers as added/removed/changed/unchanged
 * 5. Deterministic ordering (alphabetical sorting of keys)
 * 6. Helper functions (isWhitelistedHeader, getChangedHeaders)
 */

import {
  computeHeaderDiff,
  isWhitelistedHeader,
  getChangedHeaders,
} from "../headerDiff";

describe("headerDiff", () => {
  describe("computeHeaderDiff - Whitelist Enforcement", () => {
    it("Ignores non-whitelisted headers", () => {
      const leftHeaders = {
        "cache-control": "public",
        "x-custom-header": "value", // Not whitelisted
        "set-cookie": "session=abc", // Not whitelisted
      };
      const rightHeaders = {
        "cache-control": "private",
        "x-custom-header": "different", // Not whitelisted
      };

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // Only cache-control should be present
      expect(diff.core.changed).toHaveProperty("cache-control");
      expect(Object.keys(diff.core.changed)).toHaveLength(1);
      // Non-whitelisted headers should not appear
      expect(Object.keys(diff.core.added)).not.toContain("x-custom-header");
      expect(Object.keys(diff.core.removed)).not.toContain("set-cookie");
    });

    it("Only captures whitelisted core headers", () => {
      const leftHeaders = {
        "cache-control": "public",
        "content-type": "text/html",
        "vary": "Accept-Encoding",
        "www-authenticate": 'Bearer realm="api"',
        "location": "/new-location",
      };
      const rightHeaders = leftHeaders;

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // All core headers should be unchanged
      expect(Object.keys(diff.core.unchanged)).toEqual([
        "cache-control",
        "content-type",
        "location",
        "vary",
        "www-authenticate",
      ]); // Sorted
      expect(Object.keys(diff.core.added)).toHaveLength(0);
      expect(Object.keys(diff.core.removed)).toHaveLength(0);
    });
  });

  describe("computeHeaderDiff - Case Normalization", () => {
    it("Normalizes header keys to lowercase", () => {
      const leftHeaders = {
        "Cache-Control": "public",
        "Content-Type": "text/html",
      };
      const rightHeaders = {
        "cache-control": "private",
        "content-type": "application/json",
      };

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // Keys should be lowercase and changed
      expect(diff.core.changed).toHaveProperty("cache-control");
      expect(diff.core.changed).toHaveProperty("content-type");
      // Should not have uppercase versions
      expect(diff.core.changed).not.toHaveProperty("Cache-Control");
      expect(diff.core.changed).not.toHaveProperty("Content-Type");
    });

    it("Handles mixed-case header keys consistently", () => {
      const diff1 = computeHeaderDiff(
        { "Cache-Control": "public" },
        { "cache-control": "private" }
      );
      const diff2 = computeHeaderDiff(
        { "CACHE-CONTROL": "public" },
        { "CaChE-cOnTrOl": "private" }
      );

      // Both should produce identical results
      expect(diff1.core.changed).toEqual(diff2.core.changed);
    });
  });

  describe("computeHeaderDiff - Core Headers vs Access-Control", () => {
    it("Separates core headers from access-control headers", () => {
      const leftHeaders = {
        "cache-control": "public",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST",
      };
      const rightHeaders = {
        "cache-control": "private",
        "access-control-allow-origin": "https://example.com",
      };

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // Core headers should be in core group
      expect(Object.keys(diff.core.changed)).toContain("cache-control");
      expect(Object.keys(diff.core.changed)).not.toContain(
        "access-control-allow-origin"
      );

      // Access-control headers should be in accessControl group
      expect(diff.accessControl.changed).toHaveProperty(
        "access-control-allow-origin"
      );
      expect(diff.accessControl.removed).toHaveProperty(
        "access-control-allow-methods"
      );
    });

    it("Handles all access-control-* variants", () => {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "Content-Type",
        "access-control-expose-headers": "X-Custom",
        "access-control-max-age": "3600",
      };

      const diff = computeHeaderDiff({}, headers);

      // All should be in accessControl.added
      const addedKeys = Object.keys(diff.accessControl.added);
      expect(addedKeys).toContain("access-control-allow-origin");
      expect(addedKeys).toContain("access-control-allow-credentials");
      expect(addedKeys).toContain("access-control-allow-methods");
      expect(addedKeys).toContain("access-control-allow-headers");
      expect(addedKeys).toContain("access-control-expose-headers");
      expect(addedKeys).toContain("access-control-max-age");
    });
  });

  describe("computeHeaderDiff - Classification Logic", () => {
    it("Classifies headers as added (only in right)", () => {
      const diff = computeHeaderDiff({}, { "cache-control": "public" });
      expect(diff.core.added).toHaveProperty("cache-control", "public");
      expect(Object.keys(diff.core.removed)).toHaveLength(0);
    });

    it("Classifies headers as removed (only in left)", () => {
      const diff = computeHeaderDiff(
        { "cache-control": "public" },
        {}
      );
      expect(diff.core.removed).toHaveProperty("cache-control", "public");
      expect(Object.keys(diff.core.added)).toHaveLength(0);
    });

    it("Classifies headers as unchanged (same value)", () => {
      const headers = { "cache-control": "public" };
      const diff = computeHeaderDiff(headers, headers);
      expect(diff.core.unchanged).toHaveProperty("cache-control", "public");
      expect(Object.keys(diff.core.changed)).toHaveLength(0);
    });

    it("Classifies headers as changed (different values)", () => {
      const diff = computeHeaderDiff(
        { "cache-control": "public" },
        { "cache-control": "private" }
      );
      expect(diff.core.changed).toHaveProperty("cache-control");
      const cacheControl = diff.core.changed["cache-control"];
      expect(cacheControl?.left).toBe("public");
      expect(cacheControl?.right).toBe("private");
      expect(cacheControl?.changed).toBe(true);
    });

    it("Handles multiple headers of each type", () => {
      const diff = computeHeaderDiff(
        {
          "cache-control": "public",
          "content-type": "text/html",
          "vary": "Accept-Encoding",
        },
        {
          "cache-control": "private", // changed
          "content-type": "text/html", // unchanged
          "location": "/new", // added
        }
      );

      expect(Object.keys(diff.core.changed)).toEqual(["cache-control"]);
      expect(Object.keys(diff.core.unchanged)).toEqual(["content-type"]);
      expect(Object.keys(diff.core.added)).toEqual(["location"]);
      expect(Object.keys(diff.core.removed)).toEqual(["vary"]);
    });
  });

  describe("computeHeaderDiff - Deterministic Ordering", () => {
    it("Returns keys in alphabetical order", () => {
      const diff = computeHeaderDiff(
        {},
        {
          "www-authenticate": "Basic",
          "cache-control": "public",
          "vary": "Accept",
          "content-type": "text/html",
          "location": "/path",
        }
      );

      const addedKeys = Object.keys(diff.core.added);
      const expected = [
        "cache-control",
        "content-type",
        "location",
        "vary",
        "www-authenticate",
      ];
      expect(addedKeys).toEqual(expected);
    });

    it("Produces deterministic output for same input", () => {
      const headers1 = {
        "cache-control": "public",
        "content-type": "text/html",
      };
      const headers2 = {
        "cache-control": "private",
        "vary": "Accept",
      };

      const diff1 = computeHeaderDiff(headers1, headers2);
      const diff2 = computeHeaderDiff(headers1, headers2);

      expect(JSON.stringify(diff1)).toBe(JSON.stringify(diff2));
    });
  });

  describe("computeHeaderDiff - Empty Headers", () => {
    it("Handles empty left headers", () => {
      const diff = computeHeaderDiff({}, { "cache-control": "public" });
      expect(Object.keys(diff.core.added)).toEqual(["cache-control"]);
      expect(Object.keys(diff.core.removed)).toHaveLength(0);
    });

    it("Handles empty right headers", () => {
      const diff = computeHeaderDiff({ "cache-control": "public" }, {});
      expect(Object.keys(diff.core.removed)).toEqual(["cache-control"]);
      expect(Object.keys(diff.core.added)).toHaveLength(0);
    });

    it("Handles both empty headers", () => {
      const diff = computeHeaderDiff({}, {});
      expect(Object.keys(diff.core.added)).toHaveLength(0);
      expect(Object.keys(diff.core.removed)).toHaveLength(0);
      expect(Object.keys(diff.core.changed)).toHaveLength(0);
      expect(Object.keys(diff.core.unchanged)).toHaveLength(0);
    });

    it("Uses default empty object for undefined parameters", () => {
      const diff1 = computeHeaderDiff(undefined, undefined);
      const diff2 = computeHeaderDiff({}, {});
      expect(JSON.stringify(diff1)).toBe(JSON.stringify(diff2));
    });
  });

  describe("isWhitelistedHeader", () => {
    it("Accepts core whitelisted headers", () => {
      expect(isWhitelistedHeader("cache-control")).toBe(true);
      expect(isWhitelistedHeader("content-type")).toBe(true);
      expect(isWhitelistedHeader("vary")).toBe(true);
      expect(isWhitelistedHeader("www-authenticate")).toBe(true);
      expect(isWhitelistedHeader("location")).toBe(true);
    });

    it("Accepts access-control-* headers", () => {
      expect(isWhitelistedHeader("access-control-allow-origin")).toBe(true);
      expect(isWhitelistedHeader("access-control-allow-methods")).toBe(true);
      expect(isWhitelistedHeader("access-control-allow-credentials")).toBe(true);
      expect(isWhitelistedHeader("access-control-max-age")).toBe(true);
    });

    it("Rejects non-whitelisted headers", () => {
      expect(isWhitelistedHeader("set-cookie")).toBe(false);
      expect(isWhitelistedHeader("x-custom-header")).toBe(false);
      expect(isWhitelistedHeader("authorization")).toBe(false);
      expect(isWhitelistedHeader("cookie")).toBe(false);
    });

    it("Case-insensitive matching", () => {
      expect(isWhitelistedHeader("Cache-Control")).toBe(true);
      expect(isWhitelistedHeader("CONTENT-TYPE")).toBe(true);
      expect(isWhitelistedHeader("Access-Control-Allow-Origin")).toBe(true);
    });
  });

  describe("getChangedHeaders", () => {
    it("Returns empty array when headers unchanged", () => {
      const headers = {
        "cache-control": "public",
        "content-type": "text/html",
      };
      const result = getChangedHeaders(headers, headers);
      expect(result).toHaveLength(0);
    });

    it("Collects all added headers", () => {
      const result = getChangedHeaders(
        {},
        {
          "cache-control": "public",
          "content-type": "text/html",
          "vary": "Accept",
        }
      );
      expect(result).toEqual([
        "cache-control",
        "content-type",
        "vary",
      ]);
    });

    it("Collects all removed headers", () => {
      const result = getChangedHeaders(
        {
          "cache-control": "public",
          "content-type": "text/html",
        },
        {}
      );
      expect(result).toEqual([
        "cache-control",
        "content-type",
      ]);
    });

    it("Collects changed headers", () => {
      const result = getChangedHeaders(
        { "cache-control": "public" },
        { "cache-control": "private" }
      );
      expect(result).toEqual(["cache-control"]);
    });

    it("Combines all types of changes", () => {
      const result = getChangedHeaders(
        {
          "cache-control": "public", // changed
          "content-type": "text/html", // unchanged (not included)
          "vary": "Accept", // removed
        },
        {
          "cache-control": "private", // changed
          "content-type": "text/html", // unchanged
          "location": "/new", // added
        }
      );
      expect(result).toEqual([
        "cache-control",
        "location",
        "vary",
      ]); // Sorted
    });

    it("Returns sorted and deduplicated keys", () => {
      const result = getChangedHeaders(
        {
          "www-authenticate": "Basic",
          "vary": "Accept",
          "cache-control": "public",
        },
        {
          "cache-control": "private",
          "location": "/new",
          "content-type": "text/html",
        }
      );
      const expected = [
        "cache-control",
        "content-type",
        "location",
        "vary",
        "www-authenticate",
      ];
      expect(result).toEqual(expected);
    });

    it("Includes access-control header changes", () => {
      const result = getChangedHeaders(
        { "access-control-allow-origin": "*" },
        { "access-control-allow-origin": "https://example.com" }
      );
      expect(result).toEqual(["access-control-allow-origin"]);
    });
  });

  describe("computeHeaderDiff - Complex Scenarios", () => {
    it("Realistic HTTP response header comparison", () => {
      const leftHeaders = {
        "cache-control": "public, max-age=3600",
        "content-type": "application/json",
        "vary": "Accept-Encoding, Authorization",
        "access-control-allow-origin": "*",
        "x-custom": "should-be-ignored",
      };

      const rightHeaders = {
        "cache-control": "private, no-cache",
        "content-type": "application/json",
        "vary": "Accept-Encoding",
        "access-control-allow-origin": "https://example.com",
        "access-control-allow-credentials": "true",
        "set-cookie": "should-be-ignored",
      };

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // Core headers
      expect(diff.core.changed).toHaveProperty("cache-control");
      expect(diff.core.changed).toHaveProperty("vary");
      expect(diff.core.unchanged).toHaveProperty("content-type");

      // Access-control headers
      expect(diff.accessControl.changed).toHaveProperty(
        "access-control-allow-origin"
      );
      expect(diff.accessControl.added).toHaveProperty(
        "access-control-allow-credentials"
      );

      // Non-whitelisted should be ignored
      expect(Object.keys(diff.core.added)).not.toContain("set-cookie");
      expect(Object.keys(diff.core.added)).not.toContain("x-custom");
    });

    it("CORS and auth header handling", () => {
      const leftHeaders = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "Content-Type",
        "www-authenticate": 'Bearer realm="api"',
      };

      const rightHeaders = {
        "access-control-allow-origin": "https://example.com",
        "access-control-allow-methods": "GET, POST, PUT, DELETE",
        "access-control-expose-headers": "X-Total-Count",
        "www-authenticate": 'Bearer realm="api"',
      };

      const diff = computeHeaderDiff(leftHeaders, rightHeaders);

      // CORS changes
      expect(
        Object.keys(diff.accessControl.changed)
      ).toContain("access-control-allow-origin");
      expect(
        Object.keys(diff.accessControl.changed)
      ).toContain("access-control-allow-methods");
      expect(
        Object.keys(diff.accessControl.added)
      ).toContain("access-control-expose-headers");
      expect(
        Object.keys(diff.accessControl.removed)
      ).toContain("access-control-allow-headers");

      // Auth unchanged
      expect(diff.core.unchanged).toHaveProperty("www-authenticate");
    });
  });
});