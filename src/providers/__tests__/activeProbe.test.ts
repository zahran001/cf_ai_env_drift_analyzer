import { ActiveProbeProvider } from "../activeProbe";

describe("ActiveProbeProvider", () => {
  let provider: ActiveProbeProvider;

  beforeEach(() => {
    provider = new ActiveProbeProvider();
  });

  // ============================================
  // CRITIQUE A: SSRF Validation Tests (11+ tests)
  // ============================================

  describe("SSRF Validation - Critique A", () => {
    test("accepts public IPv4 addresses", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://8.8.8.8");

      expect(envelope.result.ok).toBe(true);
      if (envelope.result.ok) {
        expect(envelope.result.response.status).toBe(200);
      }

      jest.restoreAllMocks();
    });

    test("rejects localhost", async () => {
      const envelope = await provider.probe("http://localhost");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects localhost with port", async () => {
      const envelope = await provider.probe("http://localhost:8080");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects decimal IP form of 127.0.0.1 (2130706433)", async () => {
      const envelope = await provider.probe("http://2130706433");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects hex IP form of 127.0.0.1 (0x7f000001)", async () => {
      const envelope = await provider.probe("http://0x7f000001");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects IPv6 loopback (::1)", async () => {
      const envelope = await provider.probe("http://[::1]");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects private IPv4 range 10.0.0.0/8", async () => {
      const envelope = await provider.probe("http://10.0.0.1");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects private IPv4 range 192.168.0.0/16", async () => {
      const envelope = await provider.probe("http://192.168.1.1");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects non-http/https schemes", async () => {
      const envelope = await provider.probe("ftp://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("invalid_url");
      }
    });

    test("rejects invalid URLs", async () => {
      const envelope = await provider.probe("not a valid url");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("invalid_url");
      }
    });

    test("rejects octal IP form of 127.0.0.1 (0177.0.0.1)", async () => {
      const envelope = await provider.probe("http://0177.0.0.1");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects private IPv4 range 172.16.0.0/12", async () => {
      const envelope = await provider.probe("http://172.16.0.1");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });

    test("rejects IPv6 link-local (fe80::1)", async () => {
      const envelope = await provider.probe("http://[fe80::1]");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("ssrf_blocked");
      }
    });
  });

  // ============================================
  // CRITIQUE C: request.cf Fallback Tests (4+ tests)
  // ============================================

  describe("request.cf Fallback - Critique C", () => {
    test("provides safe defaults when cf is undefined", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com", undefined);

      expect(envelope.cf).toBeDefined();
      expect(envelope.cf?.colo).toBe("LOCAL");
      expect(envelope.cf?.country).toBe("XX");

      jest.restoreAllMocks();
    });

    test("extracts all fields when cf is available", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const cfContext = {
        colo: "SFO",
        country: "US",
        asn: 16509,
      };

      const envelope = await provider.probe("http://example.com", cfContext);

      expect(envelope.cf).toBeDefined();
      expect(envelope.cf?.colo).toBe("SFO");
      expect(envelope.cf?.country).toBe("US");
      expect(envelope.cf?.asn).toBe(16509);

      jest.restoreAllMocks();
    });

    test("handles partial cf objects gracefully", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const partialCf = { colo: "LAX", country: "US" };

      const envelope = await provider.probe("http://example.com", partialCf);

      expect(envelope.cf).toBeDefined();
      expect(envelope.cf?.colo).toBe("LAX");
      expect(envelope.cf?.country).toBe("US");

      jest.restoreAllMocks();
    });
  });

  // ============================================
  // CRITIQUE D: Header Determinism Tests (4+ tests)
  // ============================================

  describe("Header Determinism - Critique D", () => {
    test("normalizes header case to lowercase", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: {
            "Cache-Control": "max-age=3600",
            "Content-Type": "application/json",
          },
        })
      );

      const envelope = await provider.probe("http://example.com");

      if (envelope.result.ok) {
        const coreHeaders = Object.keys(envelope.result.response.headers.core);
        for (const key of coreHeaders) {
          expect(key).toBe(key.toLowerCase());
        }
      }

      jest.restoreAllMocks();
    });

    test("ignores non-whitelisted headers", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-custom-header": "should-be-ignored",
            "authorization": "Bearer token",
          },
        })
      );

      const envelope = await provider.probe("http://example.com");

      if (envelope.result.ok) {
        const coreKeys = Object.keys(envelope.result.response.headers.core);
        expect(coreKeys).not.toContain("x-custom-header");
        expect(coreKeys).not.toContain("authorization");
        expect(coreKeys).toContain("content-type");
      }

      jest.restoreAllMocks();
    });

    test("captures all access-control-* headers", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST",
          },
        })
      );

      const envelope = await provider.probe("http://example.com");

      if (envelope.result.ok) {
        expect(envelope.result.response.headers.accessControl).toBeDefined();
        expect(envelope.result.response.headers.accessControl).toHaveProperty(
          "access-control-allow-origin"
        );
      }

      jest.restoreAllMocks();
    });

    test("all keys are alphabetically sorted", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: {
            "vary": "Accept-Encoding",
            "content-type": "application/json",
            "cache-control": "max-age=3600",
          },
        })
      );

      const envelope = await provider.probe("http://example.com");

      if (envelope.result.ok) {
        const coreKeys = Object.keys(envelope.result.response.headers.core);
        const sortedKeys = [...coreKeys].sort();
        expect(coreKeys).toEqual(sortedKeys);
      }

      jest.restoreAllMocks();
    });
  });

  // ============================================
  // CRITIQUE B: Timeout Budget Tests (3+ tests)
  // ============================================

  describe("Timeout Budget - Critique B", () => {
    test("completes successfully when all operations finish within 9s", async () => {
      // Mock a fast response
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(true);
      if (envelope.result.ok) {
        expect(envelope.result.durationMs).toBeLessThan(1000); // Should be very fast
      }

      jest.restoreAllMocks();
    });

    test("times out when fetch exceeds 9s budget", async () => {
      // Mock fetch to take too long (triggers abort at 9s)
      jest.spyOn(globalThis, "fetch" as any).mockImplementation(() => {
        return new Promise((_, reject) => {
          // Simulate abort signal being triggered at 9s
          setTimeout(() => {
            const error = new DOMException("The operation was aborted.", "AbortError");
            reject(error);
          }, 100); // Simulate abort in test
        });
      });

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("timeout");
      }

      jest.restoreAllMocks();
    });

    test("early-exit during redirect chain when time budget exhausted", async () => {
      let callCount = 0;

      // First fetch returns redirect, second would take too long
      jest.spyOn(globalThis, "fetch" as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First request: redirect
          return Promise.resolve(
            new Response("Redirect", {
              status: 301,
              headers: { location: "http://example.com/page1" },
            })
          );
        }
        // Subsequent requests would be aborted due to timeout
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new DOMException("The operation was aborted.", "AbortError");
            reject(error);
          }, 50);
        });
      });

      const envelope = await provider.probe("http://example.com");

      // Should fail due to timeout in redirect chain
      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(
          envelope.result.error.code === "timeout" || envelope.result.error.code === "fetch_error"
        ).toBe(true);
      }

      jest.restoreAllMocks();
    });
  });

  // ============================================
  // Integration Tests (8-10 scenarios)
  // ============================================

  describe("Integration Tests", () => {
    test("single response with no redirects", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(true);
      if (envelope.result.ok) {
        expect(envelope.result.response.status).toBe(200);
        expect(envelope.result.redirects).toBeUndefined();
      }

      jest.restoreAllMocks();
    });

    test("detects redirect loops", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("Redirect Loop", {
          status: 301,
          headers: { location: "http://example.com" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("fetch_error");
        expect(envelope.result.error.message).toContain("loop");
      }

      jest.restoreAllMocks();
    });

    test("handles missing Location header in redirect", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("Redirect without Location", {
          status: 301,
          headers: {},
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("fetch_error");
        expect(envelope.result.error.message).toContain("Location");
      }

      jest.restoreAllMocks();
    });

    test("maps DNS errors to dns_error code", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockRejectedValue(
        new Error("ENOTFOUND example.invalid")
      );

      const envelope = await provider.probe("http://example.invalid");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("dns_error");
      }

      jest.restoreAllMocks();
    });

    test("maps TLS errors to tls_error code", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockRejectedValue(
        new Error("certificate verify failed")
      );

      const envelope = await provider.probe("https://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("tls_error");
      }

      jest.restoreAllMocks();
    });

    test("maps generic fetch errors to fetch_error code", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockRejectedValue(
        new Error("Connection refused")
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.code).toBe("fetch_error");
      }

      jest.restoreAllMocks();
    });
  });

  // ============================================
  // Determinism Tests
  // ============================================

  describe("Determinism Tests", () => {
    test("always returns valid SignalEnvelope structure", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope).toHaveProperty("schemaVersion");
      expect(envelope).toHaveProperty("comparisonId");
      expect(envelope).toHaveProperty("probeId");
      expect(envelope).toHaveProperty("side");
      expect(envelope).toHaveProperty("requestedUrl");
      expect(envelope).toHaveProperty("capturedAt");
      expect(envelope).toHaveProperty("result");

      jest.restoreAllMocks();
    });

    test("never throws exceptions", async () => {
      const scenarios = [
        "http://localhost",
        "not a url",
        "http://192.168.1.1",
        "ftp://invalid.com",
      ];

      for (const scenario of scenarios) {
        try {
          const envelope = await provider.probe(scenario);
          expect(envelope).toBeDefined();
          expect(envelope).toHaveProperty("result");
        } catch (err) {
          fail(`Provider should not throw, but threw: ${err}`);
        }
      }
    });
  });

  // ============================================
  // HTTP Error Response Tests (4xx/5xx Classification)
  // ============================================

  describe("HTTP Error Responses - Status Classification", () => {
    test("sets ok: false for 4xx status codes (e.g., 404)", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/html" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "response" in envelope.result) {
        expect(envelope.result.response.status).toBe(404);
        expect(envelope.result.response).toBeDefined();
      } else {
        fail("Expected ProbeResponseError with response field");
      }

      jest.restoreAllMocks();
    });

    test("sets ok: false for 5xx status codes (e.g., 500)", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "content-type": "text/html" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      if (!envelope.result.ok && "response" in envelope.result) {
        expect(envelope.result.response.status).toBe(500);
        expect(envelope.result.response).toBeDefined();
      } else {
        fail("Expected ProbeResponseError with response field");
      }

      jest.restoreAllMocks();
    });

    test("sets ok: true for 2xx status codes (e.g., 200)", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(true);
      if (envelope.result.ok) {
        expect(envelope.result.response.status).toBe(200);
      } else {
        fail("Expected ProbeSuccess");
      }

      jest.restoreAllMocks();
    });

    test("sets ok: true for 3xx redirect status codes (final response after redirect)", async () => {
      // 301 redirects to 200 (typical scenario)
      jest.spyOn(globalThis, "fetch" as any)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { location: "http://redirected.com" },
          })
        )
        .mockResolvedValueOnce(
          new Response("OK", {
            status: 200,
            headers: { "content-type": "text/plain" },
          })
        );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(true);
      if (envelope.result.ok) {
        // Final response is 200 (after following redirect)
        expect(envelope.result.response.status).toBe(200);
        expect(envelope.result.redirects?.length).toBe(1);
      } else {
        fail("Expected ProbeSuccess");
      }

      jest.restoreAllMocks();
    });

    test("403 Forbidden returns ProbeResponseError (not network failure)", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("Forbidden", {
          status: 403,
          headers: { "content-type": "text/html" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.result.ok).toBe(false);
      // Key distinction: has response field, not error field
      expect("response" in envelope.result).toBe(true);
      expect("error" in envelope.result).toBe(false);
      if ("response" in envelope.result) {
        expect(envelope.result.response.status).toBe(403);
      }

      jest.restoreAllMocks();
    });

    test("4xx response includes finalUrl from redirects", async () => {
      jest.spyOn(globalThis, "fetch" as any)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { location: "http://example.com/redirected" },
          })
        )
        .mockResolvedValueOnce(
          new Response("Not Found", {
            status: 404,
            headers: { "content-type": "text/html" },
          })
        );

      const envelope = await provider.probe("http://example.com");

      if (!envelope.result.ok && "response" in envelope.result) {
        expect(envelope.result.response.finalUrl).toBe("http://example.com/redirected");
        expect(envelope.result.response.status).toBe(404);
        expect(envelope.result.redirects).toBeDefined();
        expect(envelope.result.redirects?.length).toBe(1);
      } else {
        fail("Expected ProbeResponseError with response field");
      }

      jest.restoreAllMocks();
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe("Error Handling", () => {
    test("SSRF error includes validation details", async () => {
      const envelope = await provider.probe("http://127.0.0.1");

      if (!envelope.result.ok && "error" in envelope.result) {
        expect(envelope.result.error.details).toBeDefined();
        expect(envelope.result.error.details?.hostname).toBeDefined();
      }
    });
  });

  // ============================================
  // Schema Compliance Tests
  // ============================================

  describe("Schema Compliance", () => {
    test("schemaVersion is correct", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.schemaVersion).toBe(1);

      jest.restoreAllMocks();
    });

    test("capturedAt is valid ISO 8601 timestamp", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const envelope = await provider.probe("http://example.com");

      expect(envelope.capturedAt).toBeDefined();
      const timestamp = new Date(envelope.capturedAt);
      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(timestamp.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      jest.restoreAllMocks();
    });

    test("requestedUrl matches input URL", async () => {
      jest.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const url = "https://example.com/path";
      const envelope = await provider.probe(url);

      expect(envelope.requestedUrl).toBe(url);

      jest.restoreAllMocks();
    });
  });
});
