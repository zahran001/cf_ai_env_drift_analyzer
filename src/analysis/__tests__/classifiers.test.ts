// src/analysis/__tests__/classifiers.test.ts
import { classifyStatusDrift } from "../classifiers";

describe("classifiers", () => {
  describe("classifyStatusDrift (Rule B1)", () => {
    // Critical: 2xx vs 4xx/5xx
    it("200 vs 404 = critical (2xx vs 4xx)", () => {
      expect(classifyStatusDrift(200, 404)).toBe("critical");
    });

    it("201 vs 500 = critical (2xx vs 5xx)", () => {
      expect(classifyStatusDrift(201, 500)).toBe("critical");
    });

    it("200 vs 503 = critical (2xx vs 5xx)", () => {
      expect(classifyStatusDrift(200, 503)).toBe("critical");
    });

    it("404 vs 200 = critical (4xx vs 2xx reverse)", () => {
      expect(classifyStatusDrift(404, 200)).toBe("critical");
    });

    it("500 vs 201 = critical (5xx vs 2xx reverse)", () => {
      expect(classifyStatusDrift(500, 201)).toBe("critical");
    });

    // Critical: 3xx vs non-3xx
    it("301 vs 200 = critical (3xx vs 2xx)", () => {
      expect(classifyStatusDrift(301, 200)).toBe("critical");
    });

    it("302 vs 404 = critical (3xx vs 4xx)", () => {
      expect(classifyStatusDrift(302, 404)).toBe("critical");
    });

    it("307 vs 500 = critical (3xx vs 5xx)", () => {
      expect(classifyStatusDrift(307, 500)).toBe("critical");
    });

    it("200 vs 301 = critical (2xx vs 3xx reverse)", () => {
      expect(classifyStatusDrift(200, 301)).toBe("critical");
    });

    // Warn: within same class or other combinations
    it("200 vs 201 = warn (2xx vs 2xx)", () => {
      expect(classifyStatusDrift(200, 201)).toBe("warn");
    });

    it("404 vs 500 = warn (4xx vs 5xx)", () => {
      expect(classifyStatusDrift(404, 500)).toBe("warn");
    });

    it("301 vs 302 = warn (3xx vs 3xx)", () => {
      expect(classifyStatusDrift(301, 302)).toBe("warn");
    });

    it("403 vs 500 = warn (4xx vs 5xx)", () => {
      expect(classifyStatusDrift(403, 500)).toBe("warn");
    });

    // Edge cases
    it("100 vs 101 = warn (1xx vs 1xx)", () => {
      expect(classifyStatusDrift(100, 101)).toBe("warn");
    });

    it("418 vs 418 = warn (identical status)", () => {
      expect(classifyStatusDrift(418, 418)).toBe("warn");
    });
  });
});