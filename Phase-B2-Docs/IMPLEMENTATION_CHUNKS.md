# Phase B2 Implementation Chunks

**Purpose:** Break Phase B2 into focused, testable chunks with clear dependencies and success criteria.

**Total Effort:** 9–13 hours across 5 implementation chunks + parallel test work

---

## 📋 Overview (6 Chunks + Tests)

```
Chunk 0: Shared Helpers & Constants (1h)
  ↓
Chunk 1: Foundation (1.5h)
  ↓
Chunk 2: Routing & Redirect Utils (2h)
  ↓
Chunk 3: Header & Content Utils (3h)
  ↓
Chunk 4: Validators (0.5h)
  ↓
Chunk 5: Orchestration (2–3h)
  + Tests (2–3h, in parallel)
```

**Rationale:** `constants.ts` moved to Chunk 0 (zero dependencies, feeds validators & headerDiff early). `shared/diff.ts` helpers (dedup, sort, maxSeverity) added to Chunk 0 to unblock `classify.ts` in Chunk 5. Validators moved to Chunk 4 (depends on constants vocab).

---

## Chunk 0: Shared Helpers & Constants (1 hour)

**Dependency:** None — start here first.

### 0.1 Add Helpers to `src/shared/diff.ts` (30 min)

**Reference:** Phase-B2.md §1.1–1.2, PHASE_B2_QUICK_REFERENCE.md Finding Structure

**Responsibility:** Dedup, sort findings, compute maxSeverity (unblocks `classify.ts` later)

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

### 0.2 Implement `src/analysis/constants.ts` (30 min)

**Reference:** Phase-B2.md §3, PHASE_B2_QUICK_REFERENCE.md Timing Constants

**Responsibility:** Centralize hardcoded thresholds per Phase-B2.md (zero dependencies, feeds validators & headerDiff)

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

// Evidence vocabulary (used by validators.ts)
export const VALID_EVIDENCE_KEYS = {
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
```

**Acceptance Criteria:**
- ✅ All constants match Phase-B2.md §3
- ✅ Exported and importable
- ✅ Uses `as const` for type safety
- ✅ VALID_EVIDENCE_KEYS available for validators.ts

---

## Chunk 1: Foundation & Setup (1.5 hours)

**Dependency:** Chunk 0 (constants.ts) — start here after Chunk 0.

### 1.1 Create Directory Structure
```bash
mkdir -p src/analysis/__tests__
touch src/analysis/{probeUtils,classifiers,urlUtils,headerDiff,contentUtils,redirectUtils,cacheUtils,validators,constants,classify}.ts
touch src/analysis/__tests__/{probeUtils.test,classifiers.test,urlUtils.test,headerDiff.test,contentUtils.test,redirectUtils.test,cacheUtils.test,classify.test}.ts
```

### 1.1 Implement `src/analysis/probeUtils.ts` (30 min)

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

### 1.2 Implement `src/analysis/classifiers.ts` (30 min)

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

---

**Note:** `constants.ts` moved to Chunk 0. Both probeUtils and classifiers depend on types only (no constants yet).

## Chunk 2: Routing & Redirect Utils (2 hours)

**Dependency:** Chunk 0 (constants.ts for types), Chunk 1 (classifiers.ts)

### 2.1 Implement `src/analysis/urlUtils.ts` (1 hour)

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

### 2.2 Implement `src/analysis/redirectUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.B3, PHASE_B2_DESIGN_DECISIONS.md redirect chain comparison

**Responsibility:** Compare redirect chains, classify by hop count & final host

**Code:**
```typescript
// src/analysis/redirectUtils.ts
import type { Severity } from "../../shared/diff";

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

## Chunk 3: Header & Content Utils (3 hours)

**Dependency:** Chunk 0 (constants.ts), Chunk 1 (classifiers.ts)

### 3.1 Implement `src/analysis/headerDiff.ts` (1 hour)

**Reference:** Phase-B2.md §4.C1–C2, PHASE_B2_DESIGN_DECISIONS.md header diffing

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

**Tests:** (See IMPLEMENTATION_CHUNKS.md lines 488–545 in original, tests unchanged)

**Acceptance Criteria:**
- ✅ Whitelist enforced (only allowed headers captured)
- ✅ Case-insensitive key matching
- ✅ Access-Control headers grouped separately
- ✅ Added/removed/changed/unchanged classification
- ✅ All keys sorted

### 3.2 Implement `src/analysis/contentUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.D2–D5, PHASE_B2_DESIGN_DECISIONS.md content diffing

**Responsibility:** Normalize content-type, classify content-length drift (uses CONTENT_THRESHOLDS from Chunk 0)

**Code:** (See IMPLEMENTATION_CHUNKS.md lines 562–618 in original, unchanged)

**Tests:** (See original lines 621–680, unchanged)

**Acceptance Criteria:**
- ✅ Content-type normalization correct
- ✅ Major-type drift → critical
- ✅ Content-length thresholds correct
- ✅ Status change affects length severity

### 3.3 Implement `src/analysis/cacheUtils.ts` (1 hour)

**Reference:** Phase-B2.md §4.D1, PHASE_B2_QUICK_REFERENCE.md Cache-Control Keywords

**Responsibility:** Parse cache-control directives, detect critical keywords (uses CACHE_CRITICAL_KEYWORDS from Chunk 0)

**Code:** (See IMPLEMENTATION_CHUNKS.md lines 687–718 in original, unchanged)

**Tests:** (See original lines 722–751, unchanged)

**Acceptance Criteria:**
- ✅ Cache-control parsing correct
- ✅ Critical keyword detection works
- ✅ Drift classification matches Rule D1

---

## Chunk 4: Validators (0.5 hours)

**Dependency:** Chunk 0 (constants.ts – VALID_EVIDENCE_KEYS), Chunks 1–3 (utilities complete)

### 4.1 Implement `src/analysis/validators.ts` (30 min)

**Reference:** Phase-B2.md §1.3, PHASE_B2_QUICK_REFERENCE.md Evidence Key Vocabulary

**Responsibility:** Validate evidence keys against whitelist (moved here to depend on constants.ts), enforce determinism

**Code:** (See IMPLEMENTATION_CHUNKS.md lines 874–923 in original, but import VALID_EVIDENCE_KEYS from constants.ts instead of defining locally)

```typescript
// src/analysis/validators.ts
import type { DiffEvidence } from "../../shared/diff";
import { VALID_EVIDENCE_KEYS } from "./constants"; // ← NOW IMPORTED FROM CONSTANTS.TS

export type ValidEvidenceSection = keyof typeof VALID_EVIDENCE_KEYS;

export function validateEvidenceKeys(evidence: DiffEvidence[]): boolean {
  // ... rest unchanged
}
```

**Tests:** (See original lines 928–960, unchanged)

**Acceptance Criteria:**
- ✅ Evidence key validation correct
- ✅ Whitelist enforced (via constants.ts)
- ✅ Sorted keys enforced
- ✅ Headers accept any lowercase name

---

## Chunk 5: Orchestration (2–3 hours)

**Dependency:** Chunks 0–4 (all utilities + helpers complete)

### 5.1 Implement `src/analysis/classify.ts` (2–3 hours)

**Reference:** Phase-B2.md §4.A–G (all 14 rules), Phase-B2.md §5 (rule order)

**Responsibility:** Orchestrate all utilities, emit 14 rule findings in order, deduplicate, sort, compute maxSeverity

**Key Changes from Original:**
- Now imports `deduplicateFindings`, `sortFindings`, `computeMaxSeverity` from `shared/diff.ts` (added in Chunk 0)
- Uses constants from `constants.ts` (Chunk 0)
- Validators are already defined (Chunk 4)
- All utility functions available from earlier chunks

**Code:** (See original IMPLEMENTATION_CHUNKS.md lines 1131–1469, no functional changes to classify.ts logic—it remains the orchestrator of all 14 rules in Phase-B2.md §5 order)

**Tests:** (See original lines 1471–1480, integration tests covering all 14 rules)

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
  ├── redirectUtils.test.ts
  ├── headerDiff.test.ts
  ├── contentUtils.test.ts
  ├── cacheUtils.test.ts
  ├── validators.test.ts
  └── classify.test.ts (integration)
```

---

## Final Checklist (MVP Success Criteria)

Before calling Phase B2 done:

- [ ] All utilities implemented (probeUtils, classifiers, urlUtils, redirectUtils, headerDiff, contentUtils, cacheUtils, validators)
- [ ] Constants exported from `src/analysis/constants.ts` (TIMING_CONSTANTS, CONTENT_THRESHOLDS, CACHE_CRITICAL_KEYWORDS, HEADER_WHITELIST, VALID_EVIDENCE_KEYS)
- [ ] Shared diff helpers in `src/shared/diff.ts` (deduplicateFindings, sortFindings, computeMaxSeverity)
- [ ] `computeEnvDiff()` orchestrates all 14 rules in Phase-B2.md §5 order
- [ ] Unit tests pass for each utility
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

1. **Follow chunk order strictly**: Chunk 0 → 1 → 2 → 3 → 4 → 5
2. **Keep Phase-B2.md open** while implementing each chunk
3. **Reference PHASE_B2_QUICK_REFERENCE.md** for constants and evidence vocab
4. **Write tests as you build** each utility
5. **Snapshot test classify.ts** against Phase-B2.md examples
6. **Check determinism** by running same input twice — output must be identical
7. **Avoid timestamps/randomness** — diff engine is purely functional

---

**Revised Total Effort:** 10–14 hours (Chunk 0 adds 1 hour baseline)

**Ready to start with Chunk 0?** ✅
