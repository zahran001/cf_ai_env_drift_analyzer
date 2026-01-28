# Header Architecture: Core vs AccessControl

## High-Level Design

Your system **separates headers into two categories** for independent analysis:

```
HTTP Response Headers
    ↓
filterHeaders() [activeProbe.ts:250]
    ↓
    ├─→ Core Headers (typed, whitelisted)
    │   ├─ cache-control
    │   ├─ content-type
    │   ├─ vary
    │   ├─ www-authenticate
    │   └─ location
    │
    └─→ AccessControl Headers (untyped, prefix-based)
        ├─ access-control-allow-origin
        ├─ access-control-allow-methods
        ├─ access-control-allow-headers
        ├─ access-control-allow-credentials
        ├─ access-control-max-age
        ├─ access-control-expose-headers
        └─ [any header starting with "access-control-"]
```

---

## Why Two Categories?

### **Core Headers** (Typed, Curated List)
- **Policy:** Whitelist-based (explicit enumeration)
- **Reason:** These headers have specific security/caching implications
- **Analysis:** Each header has dedicated classification logic
  - `cache-control` → CACHE_HEADER_DRIFT (Rule D1)
  - `www-authenticate` → AUTH_CHALLENGE_PRESENT (Rule C1)
  - `content-type` → CONTENT_TYPE_DRIFT (Rule D3)
  - etc.

### **AccessControl Headers** (Flexible, Prefix-Based)
- **Policy:** Prefix-based (any `access-control-*`)
- **Reason:** CORS headers are numerous and evolving; prefix avoids hardcoding them all
- **Analysis:** Grouped together as CORS_HEADER_DRIFT (Rule C2)
  - Any `access-control-*` drift → one finding
  - Extra severity if `access-control-allow-origin` changes

---

## Code Walkthrough

### **Phase 1: Probe Capture** ([activeProbe.ts](src/providers/activeProbe.ts:250))

```typescript
function filterHeaders(headers: Headers): {
  core: CoreResponseHeaders;
  accessControl?: AccessControlHeaders
} {
  const coreHeaders: Record<string, string> = {};
  const accessControlHeaders: Record<string, string> = {};

  const coreWhitelist = [
    "cache-control",
    "content-type",
    "vary",
    "www-authenticate",
    "location",
  ];

  // Iterate ALL headers from HTTP response
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();

    // Route 1: Matches whitelist → core
    if (coreWhitelist.includes(lowerKey)) {
      coreHeaders[lowerKey] = value;
    }
    // Route 2: Starts with "access-control-" → accessControl
    else if (lowerKey.startsWith("access-control-")) {
      accessControlHeaders[lowerKey] = value;
    }
    // Route 3: Everything else → DISCARDED (privacy)
  });

  // Return structured snapshot
  return {
    core: sortedCoreHeaders,
    accessControl: Object.keys(sortedAccessControlHeaders).length > 0
      ? sortedAccessControlHeaders
      : undefined,
  };
}
```

### **Type Definitions** ([shared/signal.ts](shared/signal.ts:47-66))

```typescript
// CORE: Typed, curated list
export type CoreResponseHeaders = Partial<{
  "cache-control": string;
  "content-type": string;
  "vary": string;
  "www-authenticate": string;
  "location": string;
}>;

// ACCESSCONTROL: Flexible, any "access-control-*"
export type AccessControlHeaders = Record<string, string>;

// Combined in responses
export type ResponseHeadersSnapshot = {
  core: CoreResponseHeaders;
  accessControl?: AccessControlHeaders;  // Optional (may not exist)
};
```

### **SignalEnvelope Structure**

```typescript
{
  schemaVersion: "1",
  comparisonId: "abc123",
  probeId: "probe-left",
  side: "left",
  requestedUrl: "https://httpbin.org/response-headers?access-control-allow-origin=*",
  capturedAt: "2026-01-27T...",
  cf: { colo: "LAX", country: "US", asn: 13335 },
  result: {
    ok: true,  // Status 200 < 400
    response: {
      status: 200,
      finalUrl: "https://httpbin.org/response-headers?access-control-allow-origin=*",
      headers: {
        core: {
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
          // ← Other core headers...
        },
        accessControl: {
          "access-control-allow-origin": "*",        // ← Captured
          "access-control-allow-methods": "GET, POST",  // ← Captured
          "access-control-allow-headers": "Content-Type",  // ← Captured
          // ← All access-control-* headers captured
        }
      },
      contentLength: 1234,
      bodyHash: "abc123..."
    },
    redirects: [],
    durationMs: 145
  }
}
```

---

## Example: D2 Test Case

### **Left Probe Result**
```
GET https://httpbin.org/response-headers?access-control-allow-origin=*

HTTP/1.1 200 OK
cache-control: public, max-age=3600
content-type: application/json
access-control-allow-origin: *

{
  headers: {
    core: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json"
    },
    accessControl: {
      "access-control-allow-origin": "*"
    }
  }
}
```

### **Right Probe Result**
```
GET https://httpbin.org/response-headers?access-control-allow-origin=https://example.com

HTTP/1.1 200 OK
cache-control: public, max-age=3600
content-type: application/json
access-control-allow-origin: https://example.com

{
  headers: {
    core: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json"
    },
    accessControl: {
      "access-control-allow-origin": "https://example.com"
    }
  }
}
```

### **What SHOULD Happen in Diff Layer**

```typescript
// Diff core headers
core: {
  added: {},
  removed: {},
  changed: {},  // ← Both have same cache-control and content-type
  unchanged: {
    "cache-control": "public, max-age=3600",
    "content-type": "application/json"
  }
}

// Diff accessControl headers
accessControl: {
  added: {},
  removed: {},
  changed: {
    "access-control-allow-origin": {
      left: "*",
      right: "https://example.com",
      changed: true  // ← DETECTED
    }
  },
  unchanged: {}
}
```

### **What ACTUALLY Happens (BUG)**

```typescript
// ❌ accessControl diffs are NEVER computed
// ❌ Only core headers iterated
// ❌ Returns empty diff

headerDiff = undefined
```

---

## The Bug In Context

In [src/analysis/diff.ts:108-143](src/analysis/diff.ts#L108-L143), the `computeHeaderDiff()` function:

```typescript
const computeHeaderDiff = (...): HeaderDiff<string> => {
  const allKeys = new Set<string>();

  // ❌ BUG: Only iterates CORE headers
  if (leftHeaders.core) {
    Object.keys(leftHeaders.core).forEach((k) => allKeys.add(k));
    //                    ↑
    //     Never touches leftHeaders.accessControl
  }
  if (rightHeaders.core) {
    Object.keys(rightHeaders.core).forEach((k) => allKeys.add(k));
    //                     ↑
    //     Never touches rightHeaders.accessControl
  }

  // ❌ Compares ONLY the core headers in allKeys
  for (const key of allKeys) {
    const leftVal = leftHeaders.core?.[key as keyof typeof leftHeaders.core];
    const rightVal = rightHeaders.core?.[key as keyof typeof rightHeaders.core];
    // ... comparison ...
  }

  // ❌ Returns only core diffs; accessControl diffs are lost
  return { added, removed, changed, unchanged };
};
```

**What it should do:**
1. Iterate core headers (current behavior ✓)
2. **ALSO iterate accessControl headers** (missing)
3. Return diffs for BOTH groups

---

## Classification Rules That Depend on Headers

### **Core Headers**
- **C1: AUTH_CHALLENGE_PRESENT** - looks for `www-authenticate` changes
- **D1: CACHE_HEADER_DRIFT** - looks for `cache-control` changes
- **D2: Vary drift** - looks for `vary` changes
- **D3: CONTENT_TYPE_DRIFT** - looks for `content-type` changes

### **AccessControl Headers**
- **C2: CORS_HEADER_DRIFT** - looks for **ANY** `access-control-*` changes
  - Severity = "critical" if `access-control-allow-origin` changed
  - Severity = "warn" otherwise

---

## Summary Table

| Aspect | Core | AccessControl |
|--------|------|----------------|
| **Selection** | Whitelist (explicit names) | Prefix-based (`access-control-*`) |
| **Count** | Fixed: 5 headers | Variable: N headers |
| **Type** | Typed (`Partial<{...}>`) | Untyped (`Record<string, string>`) |
| **Diff Logic** | Per-header rules (5 rules) | Grouped rule (1 rule: C2) |
| **Expansion** | Requires code change | Automatic (prefix-based) |
| **Example** | `cache-control`, `content-type` | `access-control-allow-origin`, `access-control-allow-methods` |

---

## Why This Matters for D2

D2 tests that **CORS policy drift** (the most critical security change) is detected.

The bug breaks this by:
1. Probes capture CORS headers correctly ✓
2. Diff layer discards them ❌
3. Classifier can't find them ❌
4. Finding never generated ❌
5. LLM sees only "final URL query changed" instead of "CORS policy changed" ❌

The fix: Make `computeHeaderDiff()` also process `accessControl` headers.
