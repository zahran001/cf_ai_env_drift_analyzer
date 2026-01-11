/**
 * Tests for contentUtils.ts
 *
 * Validates:
 * 1. Content-type normalization (strip charset, lowercase)
 * 2. Content-type drift classification (major type vs minor type vs missing)
 * 3. Content-length drift thresholds (info/warn/critical by byte delta)
 * 4. Status change context for length drift severity
 * 5. Body-hash drift always critical
 */

import {
  normalizeContentType,
  classifyContentTypeDrift,
  classifyContentLengthDrift,
  classifyBodyHashDrift,
} from "../contentUtils";

describe("contentUtils", () => {
  describe("normalizeContentType", () => {
    it("Strips charset parameter from content-type", () => {
      expect(normalizeContentType("text/html; charset=utf-8")).toBe("text/html");
      expect(normalizeContentType("text/html; charset=ISO-8859-1")).toBe(
        "text/html"
      );
      expect(
        normalizeContentType("application/json; charset=utf-8")
      ).toBe("application/json");
    });

    it("Strips multiple parameters, keeps first part only", () => {
      expect(
        normalizeContentType("text/html; charset=utf-8; boundary=something")
      ).toBe("text/html");
      expect(
        normalizeContentType("multipart/form-data; boundary=----")
      ).toBe("multipart/form-data");
    });

    it("Converts to lowercase", () => {
      expect(normalizeContentType("TEXT/HTML")).toBe("text/html");
      expect(normalizeContentType("Application/JSON")).toBe("application/json");
      expect(normalizeContentType("Image/PNG")).toBe("image/png");
    });

    it("Trims whitespace around type", () => {
      expect(normalizeContentType("  text/html  ; charset=utf-8")).toBe(
        "text/html"
      );
      expect(normalizeContentType("text/html  ")).toBe("text/html");
    });

    it("Handles undefined and empty string", () => {
      expect(normalizeContentType(undefined)).toBeUndefined();
      expect(normalizeContentType("")).toBeUndefined();
    });

    it("Handles edge case: only whitespace", () => {
      expect(normalizeContentType("   ")).toBeUndefined();
    });
  });

  describe("classifyContentTypeDrift", () => {
    it("Major type differs (text vs application) → critical", () => {
      expect(classifyContentTypeDrift("text/html", "application/json")).toBe(
        "critical"
      );
      expect(classifyContentTypeDrift("image/png", "text/plain")).toBe(
        "critical"
      );
      expect(classifyContentTypeDrift("application/xml", "text/xml")).toBe(
        "critical"
      );
    });

    it("Same major type but minor differs → warn", () => {
      expect(classifyContentTypeDrift("text/html", "text/plain")).toBe("warn");
      expect(classifyContentTypeDrift("application/json", "application/xml")).toBe(
        "warn"
      );
    });

    it("Identical types → info", () => {
      expect(classifyContentTypeDrift("text/html", "text/html")).toBe("info");
      expect(
        classifyContentTypeDrift(
          "text/html; charset=utf-8",
          "text/html; charset=iso-8859-1"
        )
      ).toBe("info"); // Same after normalization
    });

    it("One side undefined → warn", () => {
      expect(classifyContentTypeDrift(undefined, "text/html")).toBe("warn");
      expect(classifyContentTypeDrift("application/json", undefined)).toBe(
        "warn"
      );
    });

    it("Both sides undefined → info", () => {
      expect(classifyContentTypeDrift(undefined, undefined)).toBe("info");
    });

    it("Case-insensitive comparison", () => {
      expect(classifyContentTypeDrift("TEXT/HTML", "text/html")).toBe("info");
      expect(classifyContentTypeDrift("Application/JSON", "application/json")).toBe(
        "info"
      );
    });

    it("Handles empty string as undefined", () => {
      expect(classifyContentTypeDrift("", "text/html")).toBe("warn");
      expect(classifyContentTypeDrift("text/html", "")).toBe("warn");
      expect(classifyContentTypeDrift("", "")).toBe("info");
    });
  });

  describe("classifyContentLengthDrift", () => {
    it("Delta < 200 bytes → info", () => {
      expect(classifyContentLengthDrift(1000, 1050)).toBe("info");
      expect(classifyContentLengthDrift(1000, 1099)).toBe("info");
      expect(classifyContentLengthDrift(1000, 1199)).toBe("info");
      expect(classifyContentLengthDrift(1000, 1001)).toBe("info");
    });

    it("Delta 200–1999 bytes → warn", () => {
      expect(classifyContentLengthDrift(1000, 1200)).toBe("warn");
      expect(classifyContentLengthDrift(1000, 2000)).toBe("warn"); // Exactly at 2000
      expect(classifyContentLengthDrift(5000, 6500)).toBe("warn");
    });

    it("Delta >= 2000 bytes + same status → critical", () => {
      expect(classifyContentLengthDrift(1000, 3000, false)).toBe("critical");
      expect(classifyContentLengthDrift(1000, 4000, false)).toBe("critical");
      expect(classifyContentLengthDrift(100, 2100, false)).toBe("critical");
    });

    it("Delta >= 2000 bytes + status changed → warn", () => {
      expect(classifyContentLengthDrift(1000, 4000, true)).toBe("warn");
      expect(classifyContentLengthDrift(100, 2100, true)).toBe("warn");
    });

    it("Handles undefined left → info", () => {
      expect(classifyContentLengthDrift(undefined, 5000)).toBe("info");
      expect(classifyContentLengthDrift(undefined, 5000, true)).toBe("info");
    });

    it("Handles undefined right → info", () => {
      expect(classifyContentLengthDrift(5000, undefined)).toBe("info");
      expect(classifyContentLengthDrift(5000, undefined, true)).toBe("info");
    });

    it("Handles both undefined → info", () => {
      expect(classifyContentLengthDrift(undefined, undefined)).toBe("info");
    });

    it("Uses absolute delta (order-independent)", () => {
      expect(classifyContentLengthDrift(1000, 1050)).toBe(
        classifyContentLengthDrift(1050, 1000)
      );
      expect(classifyContentLengthDrift(1000, 4000, false)).toBe(
        classifyContentLengthDrift(4000, 1000, false)
      );
    });

    it("Boundary: exactly at threshold transitions", () => {
      // Exactly 200 bytes (should be warn, not info)
      expect(classifyContentLengthDrift(1000, 1200)).toBe("warn");
      // Exactly 2000 bytes + status unchanged (should be critical)
      expect(classifyContentLengthDrift(1000, 3000)).toBe("critical");
      // Exactly 2000 bytes + status unchanged (should be critical)
      expect(classifyContentLengthDrift(0, 2000, false)).toBe("critical");
    });

    it("Zero delta → info", () => {
      expect(classifyContentLengthDrift(1000, 1000)).toBe("info");
      expect(classifyContentLengthDrift(0, 0)).toBe("info");
    });

    it("Large values handled correctly", () => {
      expect(classifyContentLengthDrift(1000000, 1000100)).toBe("info");
      expect(classifyContentLengthDrift(1000000, 1000500)).toBe("warn");
      expect(classifyContentLengthDrift(1000000, 1003000, false)).toBe(
        "critical"
      );
    });
  });

  describe("classifyBodyHashDrift", () => {
    it("Always returns critical", () => {
      expect(classifyBodyHashDrift()).toBe("critical");
      expect(classifyBodyHashDrift()).toBe("critical"); // Deterministic
    });
  });

  describe("Integration: realistic scenarios", () => {
    it("HTML → JSON with length increase", () => {
      // Major type drift (critical) takes precedence
      const typeSeverity = classifyContentTypeDrift("text/html", "application/json");
      const lengthSeverity = classifyContentLengthDrift(5000, 8000, false);
      expect(typeSeverity).toBe("critical");
      expect(lengthSeverity).toBe("critical");
    });

    it("HTML → HTML (different charset) + small length change", () => {
      const typeSeverity = classifyContentTypeDrift(
        "text/html; charset=utf-8",
        "text/html; charset=iso-8859-1"
      );
      const lengthSeverity = classifyContentLengthDrift(5000, 5050);
      expect(typeSeverity).toBe("info");
      expect(lengthSeverity).toBe("info");
    });

    it("Missing content-type + large length change with status change", () => {
      const typeSeverity = classifyContentTypeDrift(undefined, "text/html");
      const lengthSeverity = classifyContentLengthDrift(1000, 5000, true);
      expect(typeSeverity).toBe("warn");
      expect(lengthSeverity).toBe("warn");
    });

    it("Body hash drift context", () => {
      const hashSeverity = classifyBodyHashDrift();
      // Even if other factors are same, body hash is critical
      const typeSeverity = classifyContentTypeDrift("text/html", "text/html");
      const lengthSeverity = classifyContentLengthDrift(1000, 1000);
      expect(hashSeverity).toBe("critical");
      expect(typeSeverity).toBe("info");
      expect(lengthSeverity).toBe("info");
    });
  });
});
