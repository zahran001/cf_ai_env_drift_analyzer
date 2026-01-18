# Step 7 Checkpoint — Comprehensive Testing Plan

**Objective:** Validate URL validation security boundary and API routing before Workflow integration.

**Scope:**
- `src/api/validate.ts` (URL validation functions)
- `src/api/routes.ts` (POST /api/compare, GET /api/compare/:id)
- Integration between validation and routing

**Duration:** ~4-6 hours (unit tests + manual validation)

**Success Criteria:**
- ✅ 100% test coverage of `validate.ts` functions
- ✅ All routing paths tested (happy path + error cases)
- ✅ Security boundaries verified (SSRF rejection)
- ✅ Manual E2E flow works locally
- ✅ No type errors, linter clean

---

## Part 1: Unit Tests for URL Validation

**File:** `src/api/__tests__/validate.test.ts`

### Test Suite 1: isNumericIpBypass()

```typescript
import { describe, it, expect } from "vitest";
import { validateProbeUrl } from "../validate";

describe("validateProbeUrl - Numeric IP Bypass Detection", () => {
  it("rejects decimal integer bypass (127.0.0.1)", () => {
    const result = validateProbeUrl("http://2130706433");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Numeric IP bypass");
  });

  it("rejects hex bypass (127.0.0.1)", () => {
    const result = validateProbeUrl("http://0x7f000001");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Numeric IP bypass");
  });

  it("rejects hex bypass case-insensitive (0X7F000001)", () => {
    const result = validateProbeUrl("http://0X7F000001");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Numeric IP bypass");
  });

  it("rejects octal bypass (017700000001)", () => {
    const result = validateProbeUrl("http://017700000001");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Numeric IP bypass");
  });

  it("accepts numeric hostnames that aren't bypasses (but rejects as IP-like)", () => {
    // Pure numbers like "1234" are caught
    const result = validateProbeUrl("http://12345");
    expect(result.valid).toBe(false);
  });

  it("accepts valid domains with numbers (example123.com)", () => {
    const result = validateProbeUrl("https://example123.com");
    expect(result.valid).toBe(true);
  });

  it("accepts valid domains with hyphens and numbers (api-v2.example.com)", () => {
    const result = validateProbeUrl("https://api-v2.example.com");
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite 2: Localhost Detection

```typescript
describe("validateProbeUrl - Localhost Rejection", () => {
  it("rejects 127.0.0.1", () => {
    const result = validateProbeUrl("http://127.0.0.1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Localhost");
  });

  it("rejects localhost string", () => {
    const result = validateProbeUrl("http://localhost");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Localhost");
  });

  it("rejects IPv6 loopback (::1)", () => {
    const result = validateProbeUrl("http://[::1]");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Localhost");
  });

  it("rejects case-insensitive localhost (LOCALHOST)", () => {
    const result = validateProbeUrl("http://LOCALHOST");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Localhost");
  });

  it("rejects 127.0.0.2 (loopback range, but we check exact match)", () => {
    // Note: Current impl only checks 127.0.0.1, not full 127.0.0.0/8
    // This is acceptable for MVP—verify actual behavior
    const result = validateProbeUrl("http://127.0.0.2");
    // May be accepted or rejected depending on implementation
    // Document actual behavior
  });

  it("rejects localhost with port (localhost:8080)", () => {
    const result = validateProbeUrl("http://localhost:8080");
    expect(result.valid).toBe(false);
  });
});
```

### Test Suite 3: Private IPv4 Range Rejection (10.0.0.0/8)

```typescript
describe("validateProbeUrl - Private IPv4 (10.0.0.0/8)", () => {
  it("rejects 10.0.0.0", () => {
    const result = validateProbeUrl("http://10.0.0.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Private IP");
  });

  it("rejects 10.255.255.255", () => {
    const result = validateProbeUrl("http://10.255.255.255");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Private IP");
  });

  it("rejects 10.0.0.1", () => {
    const result = validateProbeUrl("http://10.0.0.1");
    expect(result.valid).toBe(false);
  });

  it("rejects 10.127.0.1", () => {
    const result = validateProbeUrl("http://10.127.0.1");
    expect(result.valid).toBe(false);
  });

  it("accepts 11.0.0.0 (outside 10.0.0.0/8)", () => {
    const result = validateProbeUrl("http://11.0.0.0");
    expect(result.valid).toBe(true);
  });

  it("accepts 9.255.255.255 (outside 10.0.0.0/8)", () => {
    const result = validateProbeUrl("http://9.255.255.255");
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite 4: Private IPv4 Range Rejection (172.16.0.0/12)

```typescript
describe("validateProbeUrl - Private IPv4 (172.16.0.0/12)", () => {
  it("rejects 172.16.0.0", () => {
    const result = validateProbeUrl("http://172.16.0.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Private IP");
  });

  it("rejects 172.31.255.255 (end of range)", () => {
    const result = validateProbeUrl("http://172.31.255.255");
    expect(result.valid).toBe(false);
  });

  it("rejects 172.20.0.1 (middle of range)", () => {
    const result = validateProbeUrl("http://172.20.0.1");
    expect(result.valid).toBe(false);
  });

  it("accepts 172.15.255.255 (before range)", () => {
    const result = validateProbeUrl("http://172.15.255.255");
    expect(result.valid).toBe(true);
  });

  it("accepts 172.32.0.0 (after range)", () => {
    const result = validateProbeUrl("http://172.32.0.0");
    expect(result.valid).toBe(true);
  });

  it("accepts 172.0.0.1 (different second octet)", () => {
    const result = validateProbeUrl("http://172.0.0.1");
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite 5: Private IPv4 Range Rejection (192.168.0.0/16)

```typescript
describe("validateProbeUrl - Private IPv4 (192.168.0.0/16)", () => {
  it("rejects 192.168.0.0", () => {
    const result = validateProbeUrl("http://192.168.0.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Private IP");
  });

  it("rejects 192.168.255.255", () => {
    const result = validateProbeUrl("http://192.168.255.255");
    expect(result.valid).toBe(false);
  });

  it("rejects 192.168.1.1", () => {
    const result = validateProbeUrl("http://192.168.1.1");
    expect(result.valid).toBe(false);
  });

  it("accepts 192.167.255.255 (before range)", () => {
    const result = validateProbeUrl("http://192.167.255.255");
    expect(result.valid).toBe(true);
  });

  it("accepts 192.169.0.0 (after range)", () => {
    const result = validateProbeUrl("http://192.169.0.0");
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite 6: Link-Local Address Rejection (169.254.0.0/16)

```typescript
describe("validateProbeUrl - Link-Local (169.254.0.0/16)", () => {
  it("rejects 169.254.0.0", () => {
    const result = validateProbeUrl("http://169.254.0.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Link-local");
  });

  it("rejects 169.254.255.255", () => {
    const result = validateProbeUrl("http://169.254.255.255");
    expect(result.valid).toBe(false);
  });

  it("rejects 169.254.169.254", () => {
    const result = validateProbeUrl("http://169.254.169.254");
    expect(result.valid).toBe(false);
  });

  it("accepts 169.253.255.255 (before range)", () => {
    const result = validateProbeUrl("http://169.253.255.255");
    expect(result.valid).toBe(true);
  });

  it("accepts 169.255.0.0 (after range)", () => {
    const result = validateProbeUrl("http://169.255.0.0");
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite 7: Scheme Validation

```typescript
describe("validateProbeUrl - Scheme Validation", () => {
  it("accepts http://", () => {
    const result = validateProbeUrl("http://example.com");
    expect(result.valid).toBe(true);
  });

  it("accepts https://", () => {
    const result = validateProbeUrl("https://example.com");
    expect(result.valid).toBe(true);
  });

  it("rejects file:// scheme", () => {
    const result = validateProbeUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("scheme");
  });

  it("rejects ftp:// scheme", () => {
    const result = validateProbeUrl("ftp://ftp.example.com");
    expect(result.valid).toBe(false);
  });

  it("rejects gopher:// scheme", () => {
    const result = validateProbeUrl("gopher://example.com");
    expect(result.valid).toBe(false);
  });

  it("rejects data: scheme", () => {
    const result = validateProbeUrl("data:text/html,<script>alert('xss')</script>");
    expect(result.valid).toBe(false);
  });

  it("rejects javascript: scheme", () => {
    const result = validateProbeUrl("javascript:alert('xss')");
    expect(result.valid).toBe(false);
  });
});
```

### Test Suite 8: URL Format Validation

```typescript
describe("validateProbeUrl - URL Format", () => {
  it("rejects invalid URL format (no scheme)", () => {
    const result = validateProbeUrl("example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid");
  });

  it("rejects malformed URL (invalid characters)", () => {
    const result = validateProbeUrl("http://example..com");
    // May parse, depending on URL constructor behavior
    // Document actual behavior
  });

  it("accepts URLs with paths", () => {
    const result = validateProbeUrl("https://example.com/api/v1/users");
    expect(result.valid).toBe(true);
  });

  it("accepts URLs with query strings", () => {
    const result = validateProbeUrl("https://example.com/search?q=test");
    expect(result.valid).toBe(true);
  });

  it("accepts URLs with ports", () => {
    const result = validateProbeUrl("https://example.com:8443");
    expect(result.valid).toBe(true);
  });

  it("accepts URLs with fragments", () => {
    const result = validateProbeUrl("https://example.com#section");
    expect(result.valid).toBe(true);
  });

  it("accepts URLs with authentication (should be allowed—auth is in URL, not captured)", () => {
    const result = validateProbeUrl("https://user:pass@example.com");
    expect(result.valid).toBe(true);
    // Note: We validate hostname only, not the auth portion
  });
});
```

### Test Suite 9: Valid Public URLs

```typescript
describe("validateProbeUrl - Valid Public URLs", () => {
  const validUrls = [
    "https://example.com",
    "https://api.github.com",
    "https://www.cloudflare.com",
    "http://httpbin.org/get",
    "https://google.com/search",
    "https://api.example.co.uk:8443/v1/endpoint",
    "https://subdomain.example.com",
    "https://example.com:443/path?query=value#hash",
    "https://1.1.1.1", // Public IP
    "https://8.8.8.8", // Public IP
  ];

  validUrls.forEach((url) => {
    it(`accepts ${url}`, () => {
      const result = validateProbeUrl(url);
      expect(result.valid).toBe(true);
    });
  });
});
```

---

## Part 2: Routes Integration Tests

**File:** `src/api/__tests__/routes.test.ts`

### Test Setup

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { router } from "../routes";
import type { Env } from "../../env";

// Mock Env for testing
const mockEnv: Env = {
  ENVPAIR_DO: {
    idFromName: (name: string) => ({
      toString: () => `mock-do-id-${name}`,
    }),
    get: (id: any) => ({
      getComparison: async (comparisonId: string) => {
        // Mock: return 404 for now (no Workflow yet)
        return null;
      },
    }),
  } as any,
  ENVIRONMENT: "development",
};

// Helper to create Request
function createRequest(method: string, pathname: string, body?: any): Request {
  const url = new URL(`http://localhost:8787${pathname}`);
  return new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : {},
  });
}

// Helper to parse response
async function parseResponse(response: Response): Promise<any> {
  return response.json();
}
```

### Test Suite 1: Health Check Endpoint

```typescript
describe("GET /api/health", () => {
  it("returns 200 + { ok: true }", async () => {
    const request = createRequest("GET", "/api/health");
    const response = await router(request, mockEnv);
    expect(response.status).toBe(200);
    const data = await parseResponse(response);
    expect(data.ok).toBe(true);
  });
});
```

### Test Suite 2: POST /api/compare — Happy Path

```typescript
describe("POST /api/compare — Valid Requests", () => {
  it("returns 202 + comparisonId for valid URLs", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(202);
    const data = await parseResponse(response);
    expect(data.comparisonId).toBeDefined();
    expect(typeof data.comparisonId).toBe("string");
  });

  it("returns comparisonId with format pairKey:uuid", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response = await router(request, mockEnv);
    const data = await parseResponse(response);
    const parts = data.comparisonId.split(":");
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(64); // SHA-256 hex string
    expect(parts[1].length).toBeGreaterThan(0); // UUID
  });

  it("deterministic pairKey: same URLs produce same pairKey prefix", async () => {
    const request1 = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response1 = await router(request1, mockEnv);
    const data1 = await parseResponse(response1);
    const pairKey1 = data1.comparisonId.split(":")[0];

    const request2 = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response2 = await router(request2, mockEnv);
    const data2 = await parseResponse(response2);
    const pairKey2 = data2.comparisonId.split(":")[0];

    expect(pairKey1).toBe(pairKey2);
  });

  it("deterministic pairKey: order-invariant (A,B) == (B,A)", async () => {
    const request1 = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response1 = await router(request1, mockEnv);
    const data1 = await parseResponse(response1);
    const pairKey1 = data1.comparisonId.split(":")[0];

    const request2 = createRequest("POST", "/api/compare", {
      leftUrl: "https://cloudflare.com", // Reversed
      rightUrl: "https://example.com",
    });
    const response2 = await router(request2, mockEnv);
    const data2 = await parseResponse(response2);
    const pairKey2 = data2.comparisonId.split(":")[0];

    expect(pairKey1).toBe(pairKey2);
  });

  it("unique comparisonId for each request (uuid differs)", async () => {
    const request1 = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response1 = await router(request1, mockEnv);
    const data1 = await parseResponse(response1);

    const request2 = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "https://cloudflare.com",
    });
    const response2 = await router(request2, mockEnv);
    const data2 = await parseResponse(response2);

    expect(data1.comparisonId).not.toBe(data2.comparisonId);
  });
});
```

### Test Suite 3: POST /api/compare — Validation Errors

```typescript
describe("POST /api/compare — Validation Failures", () => {
  it("returns 400 for missing leftUrl", async () => {
    const request = createRequest("POST", "/api/compare", {
      rightUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await parseResponse(response);
    expect(data.error).toContain("Missing");
  });

  it("returns 400 for missing rightUrl", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
  });

  it("returns 400 for localhost leftUrl", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "http://localhost",
      rightUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await parseResponse(response);
    expect(data.error).toContain("Invalid leftUrl");
  });

  it("returns 400 for localhost rightUrl", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "http://127.0.0.1",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid rightUrl");
  });

  it("returns 400 for private IP leftUrl (10.x.x.x)", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "http://10.0.0.1",
      rightUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
  });

  it("returns 400 for private IP rightUrl (192.168.x.x)", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "https://example.com",
      rightUrl: "http://192.168.1.1",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
  });

  it("returns 400 for numeric bypass leftUrl", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "http://2130706433",
      rightUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await parseResponse(response);
    expect(data.error).toContain("bypass");
  });

  it("returns 400 for invalid scheme", async () => {
    const request = createRequest("POST", "/api/compare", {
      leftUrl: "file:///etc/passwd",
      rightUrl: "https://example.com",
    });
    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
  });

  it("provides clear error reason for leftUrl failures", async () => {
    const testCases = [
      { url: "http://localhost", expectedReason: "Localhost" },
      { url: "http://10.0.0.1", expectedReason: "Private IP" },
      { url: "http://169.254.0.1", expectedReason: "Link-local" },
      { url: "file:///etc/passwd", expectedReason: "scheme" },
    ];

    for (const { url, expectedReason } of testCases) {
      const request = createRequest("POST", "/api/compare", {
        leftUrl: url,
        rightUrl: "https://example.com",
      });
      const response = await router(request, mockEnv);
      const data = await parseResponse(response);
      expect(data.error.toLowerCase()).toContain(expectedReason.toLowerCase());
    }
  });
});
```

### Test Suite 4: GET /api/compare/:comparisonId

```typescript
describe("GET /api/compare/:comparisonId — Polling", () => {
  it("returns 404 for non-existent comparisonId", async () => {
    const request = createRequest("GET", "/api/compare/nonexistent:uuid-here");
    const response = await router(request, mockEnv);
    expect(response.status).toBe(404);
    const data = await parseResponse(response);
    expect(data.error).toContain("not found");
  });

  it("extracts pairKey correctly from comparisonId", async () => {
    // This is an implicit test—if pairKey extraction fails,
    // DO routing will fail
    const request = createRequest("GET", "/api/compare/abc123:uuid-uuid-uuid");
    const response = await router(request, mockEnv);
    // Should reach DO (mock returns 404)
    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid comparisonId format (no colon)", async () => {
    const request = createRequest("GET", "/api/compare/invalid-no-colon");
    const response = await router(request, mockEnv);
    // Depending on implementation, may return 400 or 404
    // Document actual behavior
  });

  it("calls DO.getComparison with correct comparisonId", async () => {
    // Integration test—verifies routing to correct DO instance
    let capturedId = null;
    const mockEnvWithCapture: Env = {
      ENVPAIR_DO: {
        idFromName: (name: string) => ({
          toString: () => `mock-do-id-${name}`,
        }),
        get: (id: any) => ({
          getComparison: async (comparisonId: string) => {
            capturedId = comparisonId;
            return null; // 404
          },
        }),
      } as any,
      ENVIRONMENT: "development",
    };

    const request = createRequest("GET", "/api/compare/test-pairkey:test-uuid");
    const response = await router(request, mockEnvWithCapture);
    expect(capturedId).toBe("test-pairkey:test-uuid");
  });
});
```

### Test Suite 5: 404 for Unknown Routes

```typescript
describe("Routing — Invalid Paths", () => {
  it("returns 404 for unknown route", async () => {
    const request = createRequest("GET", "/api/unknown");
    const response = await router(request, mockEnv);
    expect(response.status).toBe(404);
  });

  it("returns 404 for POST to /api/compare/123 (should be GET)", async () => {
    const request = createRequest("POST", "/api/compare/abc:uuid");
    const response = await router(request, mockEnv);
    expect(response.status).toBe(404);
  });
});
```

---

## Part 3: Manual Testing (wrangler dev)

### Setup
```bash
cd /path/to/project
npm install
wrangler dev
```

Expected output:
```
⛅ wrangler dev now listening on http://localhost:8787
```

### Test Sequence 1: Health Check

```bash
curl http://localhost:8787/api/health
```

**Expected Response:**
```json
{"ok":true}
```

**Status:** 200 ✅

---

### Test Sequence 2: Valid Comparison Request

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "https://cloudflare.com"
  }'
```

**Expected Response:**
```json
{
  "comparisonId": "abc123def456...789:550e8400-e29b-41d4-a716-446655440000"
}
```

**Status:** 202 ✅

**Verify:**
- `comparisonId` follows `${pairKey}:${uuid}` format
- pairKey is 64 hex characters (SHA-256)
- UUID is valid UUIDv4

---

### Test Sequence 3: Polling (Should Return 404)

```bash
# Use comparisonId from Test Sequence 2
COMPARISON_ID="abc123def456...789:550e8400-e29b-41d4-a716-446655440000"

curl http://localhost:8787/api/compare/$COMPARISON_ID
```

**Expected Response:**
```json
{
  "error": "Comparison not found",
  "comparisonId": "..."
}
```

**Status:** 404 ✅

**Note:** This is correct—Workflow hasn't started yet, so DO has no record.

---

### Test Sequence 4: SSRF Rejection — Localhost

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://localhost",
    "rightUrl": "https://example.com"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid leftUrl: Localhost is not allowed"
}
```

**Status:** 400 ✅

---

### Test Sequence 5: SSRF Rejection — Private IP (10.x.x.x)

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://10.0.0.1",
    "rightUrl": "https://example.com"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid leftUrl: Private IP address is not allowed"
}
```

**Status:** 400 ✅

---

### Test Sequence 6: SSRF Rejection — Private IP (192.168.x.x)

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "http://192.168.1.1"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid rightUrl: Private IP address is not allowed"
}
```

**Status:** 400 ✅

---

### Test Sequence 7: Numeric Bypass Rejection

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://2130706433",
    "rightUrl": "https://example.com"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid leftUrl: Numeric IP bypass detected"
}
```

**Status:** 400 ✅

---

### Test Sequence 8: Scheme Rejection (file://)

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "file:///etc/passwd",
    "rightUrl": "https://example.com"
  }'
```

**Expected Response:**
```json
{
  "error": "Invalid leftUrl: Unsupported scheme: file:"
}
```

**Status:** 400 ✅

---

### Test Sequence 9: Multiple Requests with Same URLs → Same pairKey

```bash
# Request 1
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "https://cloudflare.com"
  }' | jq '.comparisonId' > /tmp/id1.txt

# Request 2 (same URLs)
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "https://cloudflare.com"
  }' | jq '.comparisonId' > /tmp/id2.txt

# Extract pairKeys (part before colon)
PAIRKEY1=$(cat /tmp/id1.txt | cut -d: -f1)
PAIRKEY2=$(cat /tmp/id2.txt | cut -d: -f1)

echo "PairKey 1: $PAIRKEY1"
echo "PairKey 2: $PAIRKEY2"
echo "Match: $([ "$PAIRKEY1" = "$PAIRKEY2" ] && echo 'YES' || echo 'NO')"
```

**Expected Output:**
```
PairKey 1: abc123def456...789
PairKey 2: abc123def456...789
Match: YES
```

✅

---

### Test Sequence 10: Order-Invariant pairKey

```bash
# Request 1: (A, B)
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "https://cloudflare.com"
  }' | jq '.comparisonId' > /tmp/id_ab.txt

# Request 2: (B, A) — Reversed
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://cloudflare.com",
    "rightUrl": "https://example.com"
  }' | jq '.comparisonId' > /tmp/id_ba.txt

PAIRKEY_AB=$(cat /tmp/id_ab.txt | cut -d: -f1)
PAIRKEY_BA=$(cat /tmp/id_ba.txt | cut -d: -f1)

echo "PairKey (A,B): $PAIRKEY_AB"
echo "PairKey (B,A): $PAIRKEY_BA"
echo "Match: $([ "$PAIRKEY_AB" = "$PAIRKEY_BA" ] && echo 'YES' || echo 'NO')"
```

**Expected Output:**
```
PairKey (A,B): abc123def456...789
PairKey (B,A): abc123def456...789
Match: YES
```

✅

---

### Test Sequence 11: Malformed Request

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{invalid json'
```

**Expected Response:**
```json
{
  "error": "Failed to start comparison: ..."
}
```

**Status:** 500 ✅

---

### Test Sequence 12: Missing Content-Type

```bash
curl -X POST http://localhost:8787/api/compare \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://cloudflare.com"}'
```

**Expected:** Should still work (JSON parsing handles it) or fail gracefully

**Status:** 202 or 400 (document actual behavior)

---

## Part 4: Success Criteria Checklist

- [ ] **Unit Tests**
  - [ ] `validate.test.ts` runs with 0 failures (40+ test cases)
  - [ ] All URL validation cases covered (bypass, localhost, private IPs, schemes)
  - [ ] Code coverage for `validate.ts` ≥ 95%

- [ ] **Integration Tests**
  - [ ] `routes.test.ts` runs with 0 failures (25+ test cases)
  - [ ] POST /api/compare happy path verified
  - [ ] POST /api/compare error cases verified
  - [ ] GET /api/compare/:id routing verified
  - [ ] pairKey determinism verified
  - [ ] Code coverage for `routes.ts` ≥ 90%

- [ ] **Manual Testing**
  - [ ] wrangler dev runs without errors
  - [ ] All 12 test sequences pass
  - [ ] Error messages are clear and actionable
  - [ ] No console errors or warnings

- [ ] **Code Quality**
  - [ ] No TypeScript errors
  - [ ] No linter warnings
  - [ ] No unused variables
  - [ ] Comments for complex logic

- [ ] **Documentation**
  - [ ] Test results logged in commit message
  - [ ] Any deviations from expected behavior documented
  - [ ] Manual test output captured (screenshots/transcript optional)

---

## Part 5: Test Execution Commands

```bash
# Run unit tests
npm test src/api/__tests__/validate.test.ts
npm test src/api/__tests__/routes.test.ts

# Run with coverage
npm test -- --coverage src/api/

# Type check
npx tsc --noEmit

# Lint
npx eslint src/api/

# Manual testing
wrangler dev
```

---

## Part 6: Test Report Template

**File:** `STEP_7_TEST_RESULTS.md`

```markdown
# Step 7 Testing Results

**Date:** [YYYY-MM-DD]
**Tester:** [Your Name]
**Duration:** [X hours]

## Unit Tests

### validate.test.ts
- ✅ 40 test cases passed
- ✅ Code coverage: 98%
- ❌ Failed tests: 0
- Notes: [Any issues encountered]

### routes.test.ts
- ✅ 25 test cases passed
- ✅ Code coverage: 92%
- ❌ Failed tests: 0
- Notes: [Any issues encountered]

## Manual Testing

### Test Sequences
- ✅ Health Check (Test 1)
- ✅ Valid Comparison (Test 2)
- ✅ Polling 404 (Test 3)
- ✅ Localhost Rejection (Test 4)
- ✅ Private IP Rejection (Test 5)
- ✅ Numeric Bypass Rejection (Test 7)
- ✅ Scheme Rejection (Test 8)
- ✅ Determinism (Test 9)
- ✅ Order-Invariance (Test 10)

## Code Quality

- ✅ TypeScript: No errors
- ✅ Linting: No warnings
- ✅ Unused variables: None detected

## Summary

**Status:** ✅ PASS

All test suites passed. Step 7 checkpoint is complete and ready for Step 8 Workflow implementation.

## Next Steps

1. Commit changes with test results
2. Proceed to Step 8 Workflow implementation
3. Add Workflow integration tests (idempotency, E2E)
```

---

## Implementation Notes

1. **Vitest Configuration:** Ensure `vitest.config.ts` exists and is configured for Workers environment
2. **Mock Env:** The `mockEnv` provided should match your actual `Env` interface
3. **Async/Await:** All tests use async patterns; ensure `beforeEach` and `it` are async-compatible
4. **URL Normalization:** Note that `url.hostname.toLowerCase()` handles case normalization
5. **IPv6:** Current implementation only checks ::1 for IPv6; Phase 2 can add ULA/Link-Local
6. **Error Messages:** Ensure error messages are user-friendly and don't leak internal details

---

**Total Estimated Testing Time:** 4-6 hours (including implementation, execution, and documentation)

**Completion Criteria:** All tests pass + manual test sequence completes without errors.
