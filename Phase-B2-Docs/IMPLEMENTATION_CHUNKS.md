# Phase B2 Implementation Chunks

**Purpose:** Break Phase B2 into focused, testable chunks with clear dependencies and success criteria.

**Total Effort:** 9–13 hours across 5 implementation chunks + parallel test work

---

## 📋 Overview (5 Chunks + Tests)

```
Chunk 1: Foundation (1.5h)
  ↓
Chunk 2: Header & Content Utils (3h)
  ↓
Chunk 3: Routing & Redirect Utils (2h)
  ↓
Chunk 4: Helper Functions & Constants (1h)
  ↓
Chunk 5: Orchestration (2–3h)
  + Tests (2–3h, in parallel)
```

---

## Chunk 1: Foundation & Setup (1.5 hours)

**Dependency:** None — start here first.

### 1.1 Create Directory Structure
```bash
mkdir -p src/analysis/__tests__
touch src/analysis/{probeUtils,classifiers,urlUtils,headerDiff,contentUtils,redirectUtils,cacheUtils,validators,constants,classify}.ts
touch src/analysis/__tests__/{probeUtils.test,classifiers.test,urlUtils.test,headerDiff.test,contentUtils.test,redirectUtils.test,cacheUtils.test,classify.test}.ts
```

### 1.2 Implement `src/analysis/probeUtils.ts` (30 min)

**Reference:** Phase-B2.md §4.A1/A2, PHASE_B2_QUICK_REFERENCE.md ProbeOutcomeDiff

**Responsibility:** Convert two SignalEnvelopes → ProbeOutcomeDiff

**Code:**
```typescript
// src/analysis/probeUtils.ts
import type { SignalEnvelope, ProbeOutcomeDiff } from "../../shared/diff";

export function compileProbeOutcomeDiff(
  left: SignalEnvelope,
  right: SignalEnvelope
): ProbeOutcomeDiff {
  const leftOk = left.result.ok;
  const rightOk = right.result.ok;

  return {
    leftOk,
    rightOk,
    leftErrorCode: !leftOk ? (left.result as any).error?.code : undefined,
    rightErrorCode: !rightOk ? (right.result as any).error?.code : undefined,
    outcomeChanged: leftOk !== rightOk,
  };
}
```

**Tests:**
```typescript
// src/analysis/__tests__/probeUtils.test.ts
import { compileProbeOutcomeDiff } from "../probeUtils";

describe("probeUtils", () => {
  it("A1: Both probes failed", () => {
    const left = { result: { ok: false, error: { code: "timeout" } } };
    const right = { result: { ok: false, error: { code: "dns" } } };
    expect(compileProbeOutcomeDiff(left as any, right as any)).toEqual({
      leftOk: false,
      rightOk: false,
      leftErrorCode: "timeout",
      rightErrorCode: "dns",
      outcomeChanged: false,
    });
  });

  it("A2: One probe failed (left)", () => {
    const left = { result: { ok: false, error: { code: "timeout" } } };
    const right = { result: { ok: true, response: { status: 200 } } };
    expect(compileProbeOutcomeDiff(left as any, right as any)).toEqual({
      leftOk: false,
      rightOk: true,
      leftErrorCode: "timeout",
      rightErrorCode: undefined,
      outcomeChanged: true,
    });
  });

  it("Both probes succeeded", () => {
    const left = { result: { ok: true, response: { status: 200 } } };
    const right = { result: { ok: true, response: { status: 200 } } };
    expect(compileProbeOutcomeDiff(left as any, right as any)).toEqual({
      leftOk: true,
      rightOk: true,
      leftErrorCode: undefined,
      rightErrorCode: undefined,
      outcomeChanged: false,
    });
  });
});
```

**Acceptance Criteria:**
- ✅ Tests pass for all 3 scenarios
- ✅ Function handles both success and failure cases
- ✅ Error codes extracted correctly

### 1.3 Implement `src/analysis/classifiers.ts` (30 min)

**Reference:** Phase-B2.md §4.B1, PHASE_B2_QUICK_REFERENCE.md Status Code Classification

**Responsibility:** Classify HTTP status code differences by severity

**Code:**
```typescript
// src/analysis/classifiers.ts
import type { Severity } from "../../shared/diff";

export function classifyStatusDrift(left: number, right: number): Severity {
  const leftClass = Math.floor(left / 100);
  const rightClass = Math.floor(right / 100);

  // 2xx vs 4xx/5xx or 3xx vs non-3xx → critical
  if ((leftClass === 2 && (rightClass === 4 || rightClass === 5)) ||
      (rightClass === 2 && (leftClass === 4 || leftClass === 5)) ||
      ((leftClass === 3 && rightClass !== 3) ||
       (rightClass === 3 && leftClass !== 3))) {
    return "critical";
  }

  // Else: warn
  return "warn";
}
```

**Tests:**
```typescript
// src/analysis/__tests__/classifiers.test.ts
import { classifyStatusDrift } from "../classifiers";

describe("classifiers", () => {
  it("2xx vs 5xx = critical", () => {
    expect(classifyStatusDrift(200, 500)).toBe("critical");
  });

  it("2xx vs 4xx = critical", () => {
    expect(classifyStatusDrift(200, 404)).toBe("critical");
  });

  it("3xx vs 2xx = critical", () => {
    expect(classifyStatusDrift(301, 200)).toBe("critical");
  });

  it("200 vs 201 = warn", () => {
    expect(classifyStatusDrift(200, 201)).toBe("warn");
  });

  it("404 vs 500 = warn", () => {
    expect(classifyStatusDrift(404, 500)).toBe("warn");
  });
});
```

**Acceptance Criteria:**
- ✅ Tests pass for all 5+ scenarios
- ✅ Correct severity for class transitions
- ✅ Within-class status codes = "warn"

### 1.4 Implement `src/analysis/constants.ts` (15 min)

**Reference:** Phase-B2.md §3, PHASE_B2_QUICK_REFERENCE.md Timing Constants

**Responsibility:** Centralize hardcoded thresholds per Phase-B2.md

**Code:**
```typescript
// src/analysis/constants.ts

// Timing thresholds (milliseconds)
export const TIMING_CONSTANTS = {
  MIN_TIMING_LEFT_MS: 50,      // Min slower duration to trigger
  ABS_DELTA_WARN_MS: 300,      // Absolute delta for "warn"
  ABS_DELTA_CRIT_MS: 1000,     // Absolute delta for "critical"
  RATIO_WARN: 1.5,              // Ratio for "warn"
  RATIO_CRIT: 2.5,              // Ratio for "critical"
} as const;

// Content thresholds (bytes)
export const CONTENT_THRESHOLDS = {
  LENGTH_DELTA_INFO_MAX: 200,    // < 200B = info
  LENGTH_DELTA_WARN_MAX: 2000,   // < 2000B = warn
  // >= 2000B = critical (if same status) or warn (if status changed)
} as const;

// Cache keywords (critical if differ)
export const CACHE_CRITICAL_KEYWORDS = ["no-store", "private"] as const;

// Header whitelist (only these captured)
export const HEADER_WHITELIST = new Set([
  "cache-control",
  "content-type",
  "vary",
  "www-authenticate",
  "location",
  // access-control-* handled separately
] as const);

// Severity ordering for sorting
export const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 } as const;
```

**Acceptance Criteria:**
- ✅ All constants match Phase-B2.md §3
- ✅ Exported and importable
- ✅ Uses `as const` for type safety

---

## Chunk 2: Header & Content Utils (3 hours)

**Dependency:** Chunk 1 (classifiers.ts)

### 2.1 Implement `src/analysis/headerDiff.ts` (1 hour)

**Reference:** Phase-B2.md §4.C1–C2 & D1–D3, PHASE_B2_DESIGN_DECISIONS.md header diffing

**Responsibility:** Normalize headers, enforce whitelist, compute added/removed/changed

**Code:**
```typescript
// src/analysis/headerDiff.ts
import type { HeaderDiff, HeaderDiffWithValue } from "../../shared/diff";
import { HEADER_WHITELIST } from "./constants";

export interface ComputedHeaderDiff {
  core: HeaderDiff;
  accessControl: HeaderDiff;
}

export function computeHeaderDiff(
  leftHeaders: Record<string, string> = {},
  rightHeaders: Record<string, string> = {}
): ComputedHeaderDiff {
  const normalizedLeft = normalizeHeaders(leftHeaders);
  const normalizedRight = normalizeHeaders(rightHeaders);

  const core = diffHeaderGroups(normalizedLeft.core, normalizedRight.core);
  const accessControl = diffHeaderGroups(
    normalizedLeft.accessControl,
    normalizedRight.accessControl
  );

  return { core, accessControl };
}

function normalizeHeaders(headers: Record<string, string>) {
  const core: Record<string, string> = {};
  const accessControl: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (lowerKey.startsWith("access-control-")) {
      accessControl[lowerKey] = value;
    } else if (HEADER_WHITELIST.has(lowerKey as any)) {
      core[lowerKey] = value;
    }
    // Non-whitelisted headers silently ignored
  }

  return { core, accessControl };
}

function diffHeaderGroups(left: Record<string, string>, right: Record<string, string>): HeaderDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: HeaderDiffWithValue[] = [];
  const unchanged: string[] = [];

  const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of allKeys) {
    const leftVal = left[key];
    const rightVal = right[key];

    if (leftVal === undefined) {
      added.push(key);
    } else if (rightVal === undefined) {
      removed.push(key);
    } else if (leftVal !== rightVal) {
      changed.push({ key, left: leftVal, right: rightVal });
    } else {
      unchanged.push(key);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed,
    unchanged: unchanged.sort(),
  };
}
```

**Tests:**
```typescript
// src/analysis/__tests__/headerDiff.test.ts
import { computeHeaderDiff } from "../headerDiff";

describe("headerDiff", () => {
  it("Whitelist enforcement: capture only allowed headers", () => {
    const left = {
      "cache-control": "no-cache",
      "x-custom": "ignored",
      "content-type": "text/html",
    };
    const right = {
      "cache-control": "max-age=3600",
      "x-custom": "also-ignored",
      "content-type": "application/json",
    };

    const diff = computeHeaderDiff(left, right);
    expect(Object.keys(diff.core)).toContain("cache-control");
    expect(Object.keys(diff.core)).toContain("content-type");
    // x-custom should NOT appear
  });

  it("Case-insensitive key matching", () => {
    const left = { "Cache-Control": "no-cache" };
    const right = { "CACHE-CONTROL": "max-age=3600" };

    const diff = computeHeaderDiff(left, right);
    expect(diff.core.changed).toHaveLength(1);
    expect(diff.core.changed[0].key).toBe("cache-control");
  });

  it("Access-Control headers grouped separately", () => {
    const left = { "access-control-allow-origin": "*" };
    const right = { "access-control-allow-origin": "https://example.com" };

    const diff = computeHeaderDiff(left, right);
    expect(diff.accessControl.changed).toHaveLength(1);
    expect(diff.core.changed).toHaveLength(0);
  });

  it("Added, removed, changed classification", () => {
    const left = {
      "cache-control": "no-cache",
      "vary": "Accept-Encoding",
    };
    const right = {
      "cache-control": "max-age=3600",
      "content-type": "text/html",
    };

    const diff = computeHeaderDiff(left, right);
    expect(diff.core.changed).toHaveLength(1); // cache-control
    expect(diff.core.removed).toContain("vary");
    expect(diff.core.added).toContain("content-type");
  });
});
```

**Acceptance Criteria:**
- ✅ Whitelist enforced (only allowed headers captured)
- ✅ Case-insensitive key matching
- ✅ Access-Control headers grouped separately
- ✅ Added/removed/changed/unchanged classification
- ✅ All keys sorted

### 2.2 Implement `src/analysis/contentUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.D2–D5, PHASE_B2_DESIGN_DECISIONS.md content diffing

**Responsibility:** Normalize content-type, classify content-length drift

**Code:**
```typescript
// src/analysis/contentUtils.ts
import type { Severity } from "../../shared/diff";
import { CONTENT_THRESHOLDS } from "./constants";

export function normalizeContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  // Split on semicolon, trim, lowercase
  return contentType.split(";")[0].trim().toLowerCase();
}

export function classifyContentTypeDrift(
  left?: string,
  right?: string
): Severity {
  const normalizedLeft = normalizeContentType(left);
  const normalizedRight = normalizeContentType(right);

  if (normalizedLeft === normalizedRight) return "info"; // No drift

  // Extract major type (text, application, etc.)
  const leftMajor = normalizedLeft?.split("/")[0];
  const rightMajor = normalizedRight?.split("/")[0];

  // If major type differs, critical
  if (leftMajor !== rightMajor) return "critical";

  // If both present but minor type differs (same major), warn
  if (normalizedLeft && normalizedRight) return "warn";

  // One missing, other present (e.g., undefined vs text/html), warn
  return "warn";
}

export function classifyContentLengthDrift(
  left?: number,
  right?: number,
  statusChanged: boolean = false
): Severity {
  if (left === undefined || right === undefined) return "info";

  const delta = Math.abs(left - right);

  // If delta < 200B, info
  if (delta < CONTENT_THRESHOLDS.LENGTH_DELTA_INFO_MAX) return "info";

  // If delta < 2000B, warn
  if (delta < CONTENT_THRESHOLDS.LENGTH_DELTA_WARN_MAX) return "warn";

  // delta >= 2000B: critical if same status, warn if status changed
  return statusChanged ? "warn" : "critical";
}

export function classifyBodyHashDrift(): Severity {
  // Body hash drift is always critical (Rule D4)
  return "critical";
}
```

**Tests:**
```typescript
// src/analysis/__tests__/contentUtils.test.ts
import {
  normalizeContentType,
  classifyContentTypeDrift,
  classifyContentLengthDrift,
} from "../contentUtils";

describe("contentUtils", () => {
  describe("normalizeContentType", () => {
    it("Strips charset and normalizes to lowercase", () => {
      expect(normalizeContentType("text/html; charset=utf-8")).toBe("text/html");
      expect(normalizeContentType("Application/JSON")).toBe("application/json");
    });

    it("Handles undefined and empty", () => {
      expect(normalizeContentType(undefined)).toBeUndefined();
      expect(normalizeContentType("")).toBeUndefined();
    });
  });

  describe("classifyContentTypeDrift", () => {
    it("text/html vs application/json (major type differs) = critical", () => {
      expect(classifyContentTypeDrift("text/html", "application/json")).toBe(
        "critical"
      );
    });

    it("text/html vs text/plain (same major) = warn", () => {
      expect(classifyContentTypeDrift("text/html", "text/plain")).toBe("warn");
    });

    it("No drift = info", () => {
      expect(classifyContentTypeDrift("text/html", "text/html")).toBe("info");
    });

    it("One missing = warn", () => {
      expect(classifyContentTypeDrift(undefined, "text/html")).toBe("warn");
    });
  });

  describe("classifyContentLengthDrift", () => {
    it("Delta < 200B = info", () => {
      expect(classifyContentLengthDrift(1000, 1050)).toBe("info");
    });

    it("Delta 200–2000B = warn", () => {
      expect(classifyContentLengthDrift(1000, 2500)).toBe("warn");
    });

    it("Delta >= 2000B + same status = critical", () => {
      expect(classifyContentLengthDrift(1000, 4000, false)).toBe("critical");
    });

    it("Delta >= 2000B + status changed = warn", () => {
      expect(classifyContentLengthDrift(1000, 4000, true)).toBe("warn");
    });
  });
});
```

**Acceptance Criteria:**
- ✅ Content-type normalization correct
- ✅ Major-type drift → critical
- ✅ Content-length thresholds correct
- ✅ Status change affects length severity

### 2.3 Implement `src/analysis/cacheUtils.ts` (45 min)

**Reference:** Phase-B2.md §4.D1, PHASE_B2_QUICK_REFERENCE.md Cache-Control Keywords

**Responsibility:** Parse cache-control directives, detect critical keywords

**Code:**
```typescript
// src/analysis/cacheUtils.ts
import { CACHE_CRITICAL_KEYWORDS } from "./constants";

export function parseCacheControl(cacheControl?: string): Set<string> {
  if (!cacheControl) return new Set();

  const directives = cacheControl
    .split(",")
    .map((d) => d.trim().split("=")[0].toLowerCase());

  return new Set(directives);
}

export function hasCriticalCacheKeyword(directives: Set<string>): boolean {
  return CACHE_CRITICAL_KEYWORDS.some((keyword) => directives.has(keyword));
}

export function classifyCacheControlDrift(
  left?: string,
  right?: string
): boolean {
  if (left === right) return false; // No drift

  const leftDirs = parseCacheControl(left);
  const rightDirs = parseCacheControl(right);

  const leftCritical = hasCriticalCacheKeyword(leftDirs);
  const rightCritical = hasCriticalCacheKeyword(rightDirs);

  // Drift exists if critical keyword presence differs
  return leftCritical !== rightCritical;
}
```

**Tests:**
```typescript
// src/analysis/__tests__/cacheUtils.test.ts
import {
  parseCacheControl,
  hasCriticalCacheKeyword,
  classifyCacheControlDrift,
} from "../cacheUtils";

describe("cacheUtils", () => {
  it("Parse cache-control directives", () => {
    const dirs = parseCacheControl("public, max-age=3600, no-store");
    expect(dirs.has("public")).toBe(true);
    expect(dirs.has("max-age")).toBe(true);
    expect(dirs.has("no-store")).toBe(true);
  });

  it("Detect critical keywords", () => {
    expect(
      hasCriticalCacheKeyword(parseCacheControl("public, private"))
    ).toBe(true);
    expect(
      hasCriticalCacheKeyword(parseCacheControl("public, max-age=3600"))
    ).toBe(false);
  });

  it("Classify cache-control drift", () => {
    expect(classifyCacheControlDrift("public", "private")).toBe(true);
    expect(classifyCacheControlDrift("public", "max-age=3600")).toBe(false);
  });
});
```

**Acceptance Criteria:**
- ✅ Cache-control parsing correct
- ✅ Critical keyword detection works
- ✅ Drift classification matches Rule D1

---

## Chunk 3: Routing & Redirect Utils (2 hours)

**Dependency:** Chunk 1 (classifiers.ts)

### 3.1 Implement `src/analysis/urlUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.B2, PHASE_B2_DESIGN_DECISIONS.md URL parsing

**Responsibility:** Parse URLs, classify drift by component (scheme/host/path/query)

**Code:**
```typescript
// src/analysis/urlUtils.ts
import type { Severity } from "../../shared/diff";

export interface UrlComponents {
  scheme?: string;
  host?: string;
  path?: string;
  query?: string;
}

export function parseUrlComponents(url?: string): UrlComponents {
  if (!url) return {};

  try {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(":", "").toLowerCase(),
      host: parsed.hostname?.toLowerCase(),
      path: parsed.pathname,
      query: parsed.search, // Includes leading ?
    };
  } catch {
    // Invalid URL
    return { scheme: "invalid" };
  }
}

export interface UrlDriftResult {
  severity: Severity;
  diffTypes: ("scheme" | "host" | "path" | "query")[];
}

export function classifyUrlDrift(
  left?: string,
  right?: string
): UrlDriftResult {
  const leftUrl = parseUrlComponents(left);
  const rightUrl = parseUrlComponents(right);

  const diffTypes: ("scheme" | "host" | "path" | "query")[] = [];

  // Check each component
  if (leftUrl.scheme !== rightUrl.scheme) diffTypes.push("scheme");
  if (leftUrl.host !== rightUrl.host) diffTypes.push("host");
  if (leftUrl.path !== rightUrl.path) diffTypes.push("path");
  if (leftUrl.query !== rightUrl.query) diffTypes.push("query");

  // Severity: critical if scheme or host differs, warn if path/query
  const severity =
    diffTypes.includes("scheme") || diffTypes.includes("host")
      ? "critical"
      : diffTypes.length > 0
      ? "warn"
      : "info";

  return { severity, diffTypes };
}
```

**Tests:**
```typescript
// src/analysis/__tests__/urlUtils.test.ts
import { parseUrlComponents, classifyUrlDrift } from "../urlUtils";

describe("urlUtils", () => {
  describe("parseUrlComponents", () => {
    it("Parse complete URL", () => {
      const url = "https://example.com:8080/path/to/resource?foo=bar#anchor";
      const result = parseUrlComponents(url);
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
      expect(result.path).toBe("/path/to/resource");
      expect(result.query).toBe("?foo=bar");
    });

    it("Case-insensitive parsing", () => {
      const result = parseUrlComponents("HTTPS://EXAMPLE.COM/Path");
      expect(result.scheme).toBe("https");
      expect(result.host).toBe("example.com");
    });

    it("Invalid URL returns partial", () => {
      const result = parseUrlComponents("not a url");
      expect(result.scheme).toBe("invalid");
    });
  });

  describe("classifyUrlDrift", () => {
    it("Scheme differs = critical", () => {
      const result = classifyUrlDrift(
        "http://example.com",
        "https://example.com"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("scheme");
    });

    it("Host differs = critical", () => {
      const result = classifyUrlDrift(
        "https://example.com",
        "https://other.com"
      );
      expect(result.severity).toBe("critical");
      expect(result.diffTypes).toContain("host");
    });

    it("Path differs = warn", () => {
      const result = classifyUrlDrift(
        "https://example.com/a",
        "https://example.com/b"
      );
      expect(result.severity).toBe("warn");
      expect(result.diffTypes).toContain("path");
    });

    it("No drift = info", () => {
      const result = classifyUrlDrift(
        "https://example.com",
        "https://example.com"
      );
      expect(result.severity).toBe("info");
      expect(result.diffTypes).toHaveLength(0);
    });
  });
});
```

**Acceptance Criteria:**
- ✅ URL parsing correct
- ✅ Scheme/host differ → critical
- ✅ Path/query differ → warn
- ✅ Case-insensitive hostname

### 3.2 Implement `src/analysis/redirectUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.B3, PHASE_B2_DESIGN_DECISIONS.md redirect chain comparison

**Responsibility:** Compare redirect chains, classify by hop count & final host

**Code:**
```typescript
// src/analysis/redirectUtils.ts
import type { Severity } from "../../shared/diff";

export interface RedirectDriftResult {
  chainChanged: boolean;
  hopCountDelta: number;
  finalHostChanged: boolean;
  severity: Severity;
}

export function compareRedirectChains(
  leftChain?: string[],
  rightChain?: string[]
): RedirectDriftResult {
  const leftChainSafe = leftChain ?? [];
  const rightChainSafe = rightChain ?? [];

  const hopCountDelta = Math.abs(
    leftChainSafe.length - rightChainSafe.length
  );

  // Extract final host from last URL in chain
  const leftFinalHost = extractFinalHost(
    leftChainSafe[leftChainSafe.length - 1]
  );
  const rightFinalHost = extractFinalHost(
    rightChainSafe[rightChainSafe.length - 1]
  );

  const finalHostChanged = leftFinalHost !== rightFinalHost;
  const chainChanged =
    JSON.stringify(leftChainSafe) !== JSON.stringify(rightChainSafe);

  // Classify severity per Phase-B2.md §4.B3
  let severity: Severity = "info";

  if (hopCountDelta >= 2) {
    severity = "critical";
  } else if (finalHostChanged) {
    severity = "critical";
  } else if (chainChanged) {
    severity = "warn";
  }

  return {
    chainChanged,
    hopCountDelta,
    finalHostChanged,
    severity,
  };
}

function extractFinalHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname?.toLowerCase();
  } catch {
    return undefined;
  }
}
```

**Tests:**
```typescript
// src/analysis/__tests__/redirectUtils.test.ts
import { compareRedirectChains } from "../redirectUtils";

describe("redirectUtils", () => {
  it("Hop count delta >= 2 = critical", () => {
    const left = ["https://a.com", "https://b.com"];
    const right = ["https://a.com", "https://b.com", "https://c.com", "https://d.com"];
    const result = compareRedirectChains(left, right);
    expect(result.hopCountDelta).toBe(2);
    expect(result.severity).toBe("critical");
  });

  it("Final host differs = critical", () => {
    const left = ["https://example.com", "https://final-a.com"];
    const right = ["https://example.com", "https://final-b.com"];
    const result = compareRedirectChains(left, right);
    expect(result.finalHostChanged).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("Chain structurally different (same hop count) = warn", () => {
    const left = ["https://a.com", "https://b.com"];
    const right = ["https://x.com", "https://b.com"];
    const result = compareRedirectChains(left, right);
    expect(result.chainChanged).toBe(true);
    expect(result.hopCountDelta).toBe(0);
    expect(result.severity).toBe("warn");
  });

  it("No redirect drift = info", () => {
    const left = ["https://example.com"];
    const right = ["https://example.com"];
    const result = compareRedirectChains(left, right);
    expect(result.chainChanged).toBe(false);
    expect(result.severity).toBe("info");
  });
});
```

**Acceptance Criteria:**
- ✅ Hop count delta calculation correct
- ✅ Final host comparison correct
- ✅ Severity thresholds match Phase-B2.md
- ✅ Handles undefined/empty chains

---

## Chunk 4: Validators & Helpers (1 hour)

**Dependency:** Chunks 1–3

### 4.1 Implement `src/analysis/validators.ts` (30 min)

**Reference:** Phase-B2.md §1.3, PHASE_B2_QUICK_REFERENCE.md Evidence Key Vocabulary

**Responsibility:** Validate evidence keys against whitelist, enforce determinism

**Code:**
```typescript
// src/analysis/validators.ts
import type { DiffEvidence } from "../../shared/diff";

const VALID_EVIDENCE_KEYS = {
  probe: ["left", "right"],
  status: [],
  finalUrl: ["scheme", "host", "path", "query", "finalUrl"],
  redirects: ["hopCount", "chain", "finalHost"],
  headers: [
    // Any lowercase header name
  ],
  content: ["content-type", "content-length", "body-hash"],
  timing: ["duration_ms"],
  cf: ["colo", "asn", "country"],
} as const;

export type ValidEvidenceSection = keyof typeof VALID_EVIDENCE_KEYS;

export function validateEvidenceKeys(evidence: DiffEvidence[]): boolean {
  for (const ev of evidence) {
    const section = ev.section as ValidEvidenceSection;
    if (!(section in VALID_EVIDENCE_KEYS)) return false;

    if (!ev.keys || ev.keys.length === 0) continue;

    const validKeys = VALID_EVIDENCE_KEYS[section];
    if (validKeys.length === 0) return false; // Section doesn't support keys

    for (const key of ev.keys) {
      if (section === "headers") {
        // Headers accept any lowercase header name
        if (key !== key.toLowerCase()) return false;
      } else if (!validKeys.includes(key as any)) {
        return false;
      }
    }

    // Verify keys are sorted
    const sorted = [...ev.keys].sort();
    if (JSON.stringify(ev.keys) !== JSON.stringify(sorted)) {
      return false;
    }
  }

  return true;
}

export function sortEvidenceKeys(evidence: DiffEvidence[]): DiffEvidence[] {
  return evidence.map((ev) => ({
    ...ev,
    keys: ev.keys ? [...ev.keys].sort() : ev.keys,
  }));
}
```

**Tests:**
```typescript
// src/analysis/__tests__/validators.test.ts
import { validateEvidenceKeys, sortEvidenceKeys } from "../validators";

describe("validators", () => {
  it("Valid evidence passes", () => {
    expect(
      validateEvidenceKeys([
        { section: "probe", keys: ["left"] },
        { section: "finalUrl", keys: ["host", "scheme"] },
      ])
    ).toBe(true);
  });

  it("Invalid section rejects", () => {
    expect(
      validateEvidenceKeys([{ section: "invalid" as any, keys: [] }])
    ).toBe(false);
  });

  it("Unsorted keys reject", () => {
    expect(
      validateEvidenceKeys([
        { section: "finalUrl", keys: ["scheme", "host"] }, // Not sorted
      ])
    ).toBe(false);
  });

  it("sortEvidenceKeys corrects order", () => {
    const evidence = [{ section: "finalUrl" as const, keys: ["host", "scheme"] }];
    const sorted = sortEvidenceKeys(evidence);
    expect(sorted[0].keys).toEqual(["scheme", "host"]);
  });
});
```

**Acceptance Criteria:**
- ✅ Evidence key validation correct
- ✅ Whitelist enforced
- ✅ Sorted keys enforced
- ✅ Headers accept any lowercase name

### 4.2 Add Helper Functions to `src/shared/diff.ts` (30 min)

**Reference:** Phase-B2.md §1.1–1.2, PHASE_B2_QUICK_REFERENCE.md Finding Structure

**Responsibility:** Dedup, sort findings, compute maxSeverity

**Code:**
```typescript
// src/shared/diff.ts (add to existing file)
import type { DiffFinding, EnvDiff, Severity } from "./diff";

export function computeDedupKey(finding: DiffFinding): string {
  const sortedKeys = finding.evidence
    ?.flatMap((ev) => ev.keys ?? [])
    .sort() ?? [];
  return `${finding.code}:${finding.evidence?.[0]?.section}:${sortedKeys.join(
    ","
  )}`;
}

export function deduplicateFindings(findings: DiffFinding[]): DiffFinding[] {
  const seen = new Map<string, DiffFinding>();

  for (const finding of findings) {
    const key = computeDedupKey(finding);
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
    // Keep first occurrence, discard duplicates
  }

  return Array.from(seen.values());
}

const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 } as const;

export function sortFindings(findings: DiffFinding[]): DiffFinding[] {
  return findings.sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.severity];
    const sevB = SEVERITY_ORDER[b.severity];
    if (sevA !== sevB) return sevA - sevB;

    const codeComp = a.code.localeCompare(b.code);
    if (codeComp !== 0) return codeComp;

    return a.message.localeCompare(b.message);
  });
}

export function computeMaxSeverity(
  findings: DiffFinding[]
): Severity {
  if (findings.length === 0) return "info";

  for (const finding of findings) {
    if (finding.severity === "critical") return "critical";
  }

  for (const finding of findings) {
    if (finding.severity === "warn") return "warn";
  }

  return "info";
}
```

**Tests:**
```typescript
// src/shared/__tests__/diff.test.ts (add to existing file)
import {
  computeDedupKey,
  deduplicateFindings,
  sortFindings,
  computeMaxSeverity,
} from "../diff";

describe("diff helpers", () => {
  it("Dedup by (code, section, sorted keys)", () => {
    const findings = [
      {
        id: "A",
        code: "STATUS_MISMATCH" as const,
        category: "routing" as const,
        severity: "critical" as const,
        message: "Status differs",
        evidence: [{ section: "status" as const }],
      },
      {
        id: "B",
        code: "STATUS_MISMATCH" as const,
        category: "routing" as const,
        severity: "critical" as const,
        message: "Status differs",
        evidence: [{ section: "status" as const }],
      },
    ];

    const deduped = deduplicateFindings(findings);
    expect(deduped).toHaveLength(1);
  });

  it("Sort by (severity DESC, code ASC, message ASC)", () => {
    const findings = [
      {
        id: "1",
        code: "B",
        severity: "info" as const,
        message: "z",
        evidence: [],
      },
      {
        id: "2",
        code: "A",
        severity: "critical" as const,
        message: "x",
        evidence: [],
      },
      {
        id: "3",
        code: "A",
        severity: "warn" as const,
        message: "y",
        evidence: [],
      },
    ] as any;

    const sorted = sortFindings(findings);
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].severity).toBe("warn");
    expect(sorted[2].severity).toBe("info");
  });

  it("computeMaxSeverity", () => {
    expect(
      computeMaxSeverity([
        { severity: "info" } as any,
        { severity: "critical" } as any,
      ])
    ).toBe("critical");
    expect(computeMaxSeverity([])).toBe("info");
  });
});
```

**Acceptance Criteria:**
- ✅ Dedup key computation correct
- ✅ Sorting order correct
- ✅ Max severity correct

---

## Chunk 5: Orchestration (2–3 hours)

**Dependency:** Chunks 1–4 (all utilities complete)

### 5.1 Implement `src/analysis/classify.ts` (2–3 hours)

**Reference:** Phase-B2.md §4.A–G (all 14 rules), Phase-B2.md §5 (rule order)

**Responsibility:** Orchestrate all utilities, emit 14 rule findings in order, deduplicate, sort, compute maxSeverity

**Code:**
```typescript
// src/analysis/classify.ts
import type { SignalEnvelope, EnvDiff, DiffFinding } from "../../shared/diff";
import {
  deduplicateFindings,
  sortFindings,
  computeMaxSeverity,
} from "../../shared/diff";

import { compileProbeOutcomeDiff } from "./probeUtils";
import { classifyStatusDrift } from "./classifiers";
import { classifyUrlDrift } from "./urlUtils";
import { compareRedirectChains } from "./redirectUtils";
import { computeHeaderDiff } from "./headerDiff";
import { classifyContentTypeDrift, classifyContentLengthDrift } from "./contentUtils";
import { classifyCacheControlDrift } from "./cacheUtils";

export function computeEnvDiff(
  comparisonId: string,
  leftProbeId: string,
  rightProbeId: string,
  left: SignalEnvelope,
  right: SignalEnvelope
): EnvDiff {
  const findings: DiffFinding[] = [];

  // Rule A: Probe outcomes
  const probeDiff = compileProbeOutcomeDiff(left, right);

  if (!probeDiff.leftOk && !probeDiff.rightOk) {
    // A1: Both probes failed
    findings.push({
      id: "PROBE_FAILURE:probe:",
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: "Both probes failed",
      evidence: [{ section: "probe" }],
    });
  } else if (probeDiff.outcomeChanged) {
    // A2: One probe failed
    const failedSide = probeDiff.leftOk ? "right" : "left";
    findings.push({
      id: `PROBE_FAILURE:probe:${failedSide}`,
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: `${failedSide === "left" ? "Left" : "Right"} probe failed (${probeDiff[`${failedSide}ErrorCode`] || "unknown"})`,
      evidence: [{ section: "probe", keys: [failedSide] }],
    });
  }

  // If either probe failed, stop here (can't analyze further)
  if (!probeDiff.leftOk || !probeDiff.rightOk) {
    const deduped = deduplicateFindings(findings);
    const sorted = sortFindings(deduped);
    const maxSeverity = computeMaxSeverity(sorted);

    return {
      schemaVersion: "1.0",
      comparisonId,
      leftProbeId,
      rightProbeId,
      probe: probeDiff,
      findings: sorted,
      maxSeverity,
    };
  }

  // From here, both probes succeeded
  const leftResp = (left.result as any).response;
  const rightResp = (right.result as any).response;

  const leftStatus = leftResp.status;
  const rightStatus = rightResp.status;
  const leftUrl = left.target_url;
  const rightUrl = right.target_url;
  const leftHeaders = leftResp.headers || {};
  const rightHeaders = rightResp.headers || {};

  // Rule B1: Status mismatch
  if (leftStatus !== rightStatus) {
    const severity = classifyStatusDrift(leftStatus, rightStatus);
    findings.push({
      id: "STATUS_MISMATCH:status:",
      code: "STATUS_MISMATCH",
      category: "routing",
      severity,
      message: `Status: ${leftStatus} vs ${rightStatus}`,
      evidence: [{ section: "status" }],
      left_value: leftStatus,
      right_value: rightStatus,
    });
  }

  // Rule B2: Final URL mismatch
  if (leftUrl !== rightUrl) {
    const urlDrift = classifyUrlDrift(leftUrl, rightUrl);
    findings.push({
      id: `FINAL_URL_MISMATCH:finalUrl:${urlDrift.diffTypes.sort().join(",")}`,
      code: "FINAL_URL_MISMATCH",
      category: "routing",
      severity: urlDrift.severity,
      message: `URL: ${leftUrl} vs ${rightUrl}`,
      evidence: [
        {
          section: "finalUrl",
          keys: urlDrift.diffTypes.sort(),
        },
      ],
      left_value: leftUrl,
      right_value: rightUrl,
    });
  }

  // Rule B3: Redirect chain changed
  const leftRedirects = left.routing?.redirect_chain;
  const rightRedirects = right.routing?.redirect_chain;
  if (JSON.stringify(leftRedirects) !== JSON.stringify(rightRedirects)) {
    const redirectDrift = compareRedirectChains(leftRedirects, rightRedirects);
    const diffKeys = [];
    if (redirectDrift.hopCountDelta >= 2) diffKeys.push("hopCount");
    if (redirectDrift.finalHostChanged) diffKeys.push("finalHost");
    if (redirectDrift.chainChanged && diffKeys.length === 0)
      diffKeys.push("chain");

    findings.push({
      id: `REDIRECT_CHAIN_CHANGED:redirects:${diffKeys.sort().join(",")}`,
      code: "REDIRECT_CHAIN_CHANGED",
      category: "routing",
      severity: redirectDrift.severity,
      message: `Redirect chain: ${leftRedirects?.length ?? 0} hops vs ${rightRedirects?.length ?? 0}`,
      evidence: [
        {
          section: "redirects",
          keys: diffKeys.sort(),
        },
      ],
      left_value: leftRedirects,
      right_value: rightRedirects,
    });
  }

  // Rule C & D: Header-based findings
  const headerDiff = computeHeaderDiff(leftHeaders, rightHeaders);

  // Rule C1: Auth challenge (www-authenticate)
  if (
    headerDiff.core.changed.some((h) => h.key === "www-authenticate") ||
    headerDiff.core.added.includes("www-authenticate") ||
    headerDiff.core.removed.includes("www-authenticate")
  ) {
    const leftAuth = leftHeaders["www-authenticate"];
    const rightAuth = rightHeaders["www-authenticate"];
    const severity =
      (leftAuth === undefined) !== (rightAuth === undefined)
        ? "critical"
        : "warn";

    findings.push({
      id: "AUTH_CHALLENGE_PRESENT:headers:www-authenticate",
      code: "AUTH_CHALLENGE_PRESENT",
      category: "security",
      severity,
      message: `WWW-Authenticate: ${leftAuth ?? "absent"} vs ${rightAuth ?? "absent"}`,
      evidence: [{ section: "headers", keys: ["www-authenticate"] }],
      left_value: leftAuth,
      right_value: rightAuth,
    });
  }

  // Rule C2: CORS header drift
  if (Object.keys(headerDiff.accessControl.changed).length > 0 ||
      headerDiff.accessControl.added.length > 0 ||
      headerDiff.accessControl.removed.length > 0) {
    const allAcKeys = [
      ...headerDiff.accessControl.changed.map((h) => h.key),
      ...headerDiff.accessControl.added,
      ...headerDiff.accessControl.removed,
    ].sort();

    const severity = headerDiff.accessControl.changed.some(
      (h) => h.key === "access-control-allow-origin"
    )
      ? "critical"
      : "warn";

    findings.push({
      id: `CORS_HEADER_DRIFT:headers:${allAcKeys.join(",")}`,
      code: "CORS_HEADER_DRIFT",
      category: "security",
      severity,
      message: `CORS headers differ`,
      evidence: [{ section: "headers", keys: allAcKeys }],
    });
  }

  // Rule D1: Cache-control drift
  const leftCache = leftHeaders["cache-control"];
  const rightCache = rightHeaders["cache-control"];
  if (classifyCacheControlDrift(leftCache, rightCache)) {
    findings.push({
      id: "CACHE_HEADER_DRIFT:headers:cache-control",
      code: "CACHE_HEADER_DRIFT",
      category: "cache",
      severity: "critical",
      message: `Cache-Control: ${leftCache ?? "(none)"} vs ${rightCache ?? "(none)"}`,
      evidence: [{ section: "headers", keys: ["cache-control"] }],
      left_value: leftCache,
      right_value: rightCache,
    });
  }

  // Rule D2: Vary drift → UNKNOWN_DRIFT (handled below)

  // Rule D3: Content-type drift
  const leftCt = leftHeaders["content-type"];
  const rightCt = rightHeaders["content-type"];
  const ctDrift = classifyContentTypeDrift(leftCt, rightCt);
  if (ctDrift !== "info") {
    findings.push({
      id: "CONTENT_TYPE_DRIFT:headers:content-type",
      code: "CONTENT_TYPE_DRIFT",
      category: "content",
      severity: ctDrift,
      message: `Content-Type: ${leftCt ?? "(none)"} vs ${rightCt ?? "(none)"}`,
      evidence: [{ section: "headers", keys: ["content-type"] }],
      left_value: leftCt,
      right_value: rightCt,
    });
  }

  // Rule D4: Body hash drift (content-length as proxy)
  // Simplified: if content-length differs AND status/content-type unchanged
  const leftLen = leftHeaders["content-length"];
  const rightLen = rightHeaders["content-length"];
  const leftLenNum = leftLen ? parseInt(leftLen, 10) : undefined;
  const rightLenNum = rightLen ? parseInt(rightLen, 10) : undefined;

  if (leftLenNum !== undefined && rightLenNum !== undefined && leftLenNum !== rightLenNum) {
    if (leftStatus === rightStatus && leftCt === rightCt) {
      findings.push({
        id: "BODY_HASH_DRIFT:content:body-hash",
        code: "BODY_HASH_DRIFT",
        category: "content",
        severity: "critical",
        message: `Body changed (content-length: ${leftLenNum} vs ${rightLenNum})`,
        evidence: [{ section: "content", keys: ["body-hash"] }],
        left_value: leftLenNum,
        right_value: rightLenNum,
      });
    }
  }

  // Rule D5: Content-length drift
  if (leftLenNum !== undefined && rightLenNum !== undefined && leftLenNum !== rightLenNum) {
    const statusChanged = leftStatus !== rightStatus;
    const severity = classifyContentLengthDrift(
      leftLenNum,
      rightLenNum,
      statusChanged
    );
    if (severity !== "info") {
      findings.push({
        id: "CONTENT_LENGTH_DRIFT:content:content-length",
        code: "CONTENT_LENGTH_DRIFT",
        category: "content",
        severity,
        message: `Content-Length: ${leftLenNum} vs ${rightLenNum}`,
        evidence: [{ section: "content", keys: ["content-length"] }],
        left_value: leftLenNum,
        right_value: rightLenNum,
      });
    }
  }

  // Rule E1: Timing drift
  const leftDuration = left.timing?.duration_ms;
  const rightDuration = right.timing?.duration_ms;
  // (Simplified; full logic in Phase-B2.md §4.E1)

  // Rule F1: CF context drift (soft correlation)
  const leftCf = left.runner_context;
  const rightCf = right.runner_context;
  const cfDiffers =
    leftCf?.colo !== rightCf?.colo ||
    leftCf?.asn !== rightCf?.asn ||
    leftCf?.country !== rightCf?.country;

  if (cfDiffers) {
    // Soft correlation: severity depends on timing drift
    const hasTiming = leftDuration && rightDuration;
    const severity = hasTiming ? "warn" : "info";

    const cfKeys = [];
    if (leftCf?.colo !== rightCf?.colo) cfKeys.push("colo");
    if (leftCf?.asn !== rightCf?.asn) cfKeys.push("asn");
    if (leftCf?.country !== rightCf?.country) cfKeys.push("country");

    findings.push({
      id: `CF_CONTEXT_DRIFT:cf:${cfKeys.sort().join(",")}`,
      code: "CF_CONTEXT_DRIFT",
      category: "platform",
      severity,
      message: `CF context: ${leftCf?.colo || "?"} vs ${rightCf?.colo || "?"}`,
      evidence: [{ section: "cf", keys: cfKeys.sort() }],
    });
  }

  // Rule G1: Remaining header drift (UNKNOWN_DRIFT)
  for (const key of headerDiff.core.added) {
    if (!["cache-control", "content-type", "www-authenticate"].includes(key)) {
      findings.push({
        id: `UNKNOWN_DRIFT:headers:${key}`,
        code: "UNKNOWN_DRIFT",
        category: "unknown",
        severity: "warn",
        message: `Header added: ${key}`,
        evidence: [{ section: "headers", keys: [key] }],
      });
    }
  }

  // Dedup, sort, compute maxSeverity
  const deduped = deduplicateFindings(findings);
  const sorted = sortFindings(deduped);
  const maxSeverity = computeMaxSeverity(sorted);

  return {
    schemaVersion: "1.0",
    comparisonId,
    leftProbeId,
    rightProbeId,
    probe: probeDiff,
    findings: sorted,
    maxSeverity,
  };
}
```

**Tests:**

Create comprehensive integration tests covering all 14 rules. See PHASE_B2_DESIGN_DECISIONS.md for example test cases.

**Acceptance Criteria:**
- ✅ All 14 rules implemented in Phase-B2.md §5 order
- ✅ Integration tests pass (all 14 rules)
- ✅ Findings deduplicated & sorted correctly
- ✅ maxSeverity computed
- ✅ Output matches Phase-B2.md examples byte-for-byte

---

## Testing Strategy (In Parallel)

### Unit Tests (Per Chunk)
- 30 min per chunk (during implementation)
- Test each utility independently

### Integration Tests (After Chunk 5)
- Snapshot tests for all 14 rules
- Example inputs from Phase-B2.md
- Verify byte-for-byte match

**Test Files:**
```
src/analysis/__tests__/
  ├── probeUtils.test.ts
  ├── classifiers.test.ts
  ├── urlUtils.test.ts
  ├── headerDiff.test.ts
  ├── contentUtils.test.ts
  ├── redirectUtils.test.ts
  ├── cacheUtils.test.ts
  ├── validators.test.ts
  └── classify.test.ts (integration)
```

---

## Final Checklist (MVP Success Criteria)

Before calling Phase B2 done:

- [ ] All 9 utility modules implemented
- [ ] `computeEnvDiff()` orchestrates all 14 rules in Phase-B2.md §5 order
- [ ] Unit tests pass for each utility (9 utilities)
- [ ] Integration tests pass (all 14 rules with snapshot matching)
- [ ] Output matches Phase-B2.md examples byte-for-byte
- [ ] Evidence keys validated against Phase-B2.md §1.3 whitelist
- [ ] Findings sorted by (severity, code, message) deterministically
- [ ] maxSeverity computed correctly (critical > warning > info)
- [ ] No timestamps, UUIDs, or randomness in diff engine
- [ ] Rule D1 (cache-control) passes with cacheUtils.ts
- [ ] Validators confirm evidence key compliance
- [ ] Code review checklist complete (CLAUDE.md §15)

---

## Implementation Tips

1. **Keep Phase-B2.md open** while implementing each chunk
2. **Reference PHASE_B2_QUICK_REFERENCE.md** for constants and evidence vocab
3. **Write tests as you build** each utility
4. **Snapshot test classify.ts** against Phase-B2.md examples
5. **Check determinism** by running same input twice — output must be identical
6. **Avoid timestamps/randomness** — diff engine is purely functional

---

**Total Effort:** 9–13 hours

**Ready to start Chunk 1?** ✅

