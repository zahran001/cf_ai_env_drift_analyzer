# Frontend Constitution — cf_ai_env_drift_analyzer UI

**Authority:** This document enforces non-negotiable technical and architectural constraints for the React frontend. Extracted from `../../UI_IMPLEMENTATION_PLAN.md` (Sections 2.1–2.5, 3G–3H, Part 7).

**Last Updated:** 2026-02-05
**Status:** MVP Enforcement

---

## 1. Tech Stack (Non-Negotiable)

### 1.1 Core Frameworks
- **React:** 19.2 (already in package.json)
- **Build Tool:** Vite 7.2 (already in package.json)
- **Language:** TypeScript 5.x (Strict Mode, zero `any` types)
- **Runtime:** Node.js 18+ (development)

**Invariant:** No framework substitutions (Vue, Svelte, etc.). No version downgrades without explicit approval.

### 1.2 Styling (CRITICAL CONSTRAINT)

**ALLOWED:**
- ✅ CSS Modules (Vite native support)
- ✅ Inline styles (React `style` prop)
- ✅ Plain `.css` files

**EXPLICITLY FORBIDDEN:**
- ⛔️ **Tailwind CSS** — Do NOT add to package.json
- ⛔️ **shadcn/ui** — Do NOT install
- ⛔️ **Emotion** — Do NOT use
- ⛔️ **Styled Components** — Do NOT use
- ⛔️ **PostCSS plugins** — Do NOT configure

**Rationale:** MVP scope demands minimal dependencies and fast iteration. If Phase 2 requires Tailwind, a deliberate refactor will occur AFTER MVP is stable.

**Enforcement:** Code review must catch any CSS framework imports. If found, request removal before merge.

### 1.3 State Management (REQUIRED)

**ALLOWED:**
- ✅ React `useState` hook
- ✅ React `useCallback` hook
- ✅ Custom hooks (e.g., `usePairHistory`, `useComparisonPoll`)
- ✅ Context API (for deep nesting, if needed in Phase 2)

**FORBIDDEN:**
- ⛔️ Redux
- ⛔️ Zustand
- ⛔️ MobX
- ⛔️ Jotai
- ⛔️ Recoil

**Rationale:** MVP scope doesn't require centralized state. Hooks + localStorage provide sufficient state management.

### 1.4 HTTP & API

**REQUIRED:**
- Use `fetch` API (builtin to browsers)
- Type all API responses from `@shared/*` contracts
- Always use `cache: 'no-store'` for polling requests (design requirement)

**Forbidden:**
- ⛔️ Axios (use `fetch` instead)
- ⛔️ GraphQL clients (not part of MVP)

---

## 2. Import Contracts & Type Safety (CRITICAL)

### 2.1 @shared/* Alias (REQUIRED)

**All component prop types MUST be imported from `@shared/` using the alias:**

```typescript
// ✅ CORRECT
import type { CompareResult, DiffFinding, Severity } from "@shared/api";
import type { SignalEnvelope } from "@shared/signal";
import type { EnvDiff } from "@shared/diff";
import type { LlmExplanation } from "@shared/llm";
import type { CompareError } from "@shared/api";

// ❌ WRONG
import type { CompareResult } from "../../shared/api";  // No relative paths
import type { Severity } from "./types";              // No local duplication
```

**Enforcement:** Linter rule + code review. Reject any sibling imports or type duplication.

### 2.2 Type Safety Requirements

**MANDATORY:**
- Zero `any` types (except `unknown` with explicit cast)
- All component props must be typed
- All hook return values must be typed
- Optional fields must use `?:` or `| undefined`
- Nullable values must use `| null` or `?:` (not coerced to string)

**Example:**
```typescript
interface SummaryStripProps {
  result: CompareResult;           // ✅ Typed from @shared
  status?: CompareStatus;          // ✅ Optional
  error?: CompareError | null;     // ✅ Explicit null union
}

// ❌ DO NOT DO THIS
interface BadProps {
  result: any;                     // WRONG
  severity: "critical" | "warn";   // WRONG: Duplicate from @shared
  onClose?() {}                    // WRONG: Missing return type
}
```

### 2.3 Shared Module Inventory

**Available in `/shared/` (source of truth):**
- `shared/api.ts` — `CompareResult`, `CompareRequest`, `CompareStatus`, `CompareError`, `CompareErrorCode`
- `shared/diff.ts` — `EnvDiff`, `DiffFinding`, `FindingCategory`, `Severity`
- `shared/signal.ts` — `SignalEnvelope`, `ProbeError`
- `shared/llm.ts` — `LlmExplanation`, `RankedCause`, `RecommendedAction`

**Invariant:** Do NOT duplicate these types in `src/`. Always import from `@shared/`.

---

## 3. Component Structure & Architecture

### 3.1 Directory Layout

```
pages/
├── src/
│   ├── components/           # React components (presentational)
│   │   ├── ControlPlane.tsx
│   │   ├── SummaryStrip.tsx
│   │   ├── ExplanationPanel.tsx
│   │   ├── FindingsList.tsx
│   │   ├── FindingDetailView.tsx
│   │   ├── RawDataView.tsx
│   │   ├── ErrorBanner.tsx
│   │   └── ProgressIndicator.tsx
│   │
│   ├── hooks/                # Custom hooks (state, side effects)
│   │   ├── usePairHistory.ts
│   │   ├── useComparisonPoll.ts
│   │   └── [other hooks]
│   │
│   ├── lib/                  # Utilities (no React)
│   │   ├── api.ts            # Fetch wrappers
│   │   ├── errorMapping.ts   # Error code → human guidance
│   │   └── [other utils]
│   │
│   └── App.tsx               # Root component
│
├── .specify/                 # Specification files
│   ├── constitution.md       # This file
│   ├── spec.md
│   └── plan.md
│
└── tsconfig.app.json         # Must include @shared path alias
```

### 3.2 Component Design Principles

**Stateless where possible:**
- Props come from @shared/* contracts
- Avoid local prop duplication
- Use composition for reusability

**Graceful degradation (Gotchas Fixed):**
- All optional fields in DiffFinding: `left_value?`, `right_value?`, `evidence?`
- Use optional chaining: `result.diff?.findings ?? []`
- Render "Data unavailable" gracefully, never throw

**Example:**
```typescript
export const SummaryStrip: FC<SummaryStripProps> = ({ result }) => {
  // ✅ Safe casting
  const diff = result.diff as EnvDiff | undefined;
  const findings = diff?.findings ?? [];
  const maxSeverity = diff?.findings?.length
    ? diff.findings.reduce((max, f) => compareSeverity(max, f.severity), "info" as Severity)
    : "info";

  return <div>{/* render safely */}</div>;
};
```

---

## 4. State Management Pattern

### 4.1 App-Level State (Root)

```typescript
// App.tsx
const [leftUrl, setLeftUrl] = useState("");
const [rightUrl, setRightUrl] = useState("");
const [leftLabel, setLeftLabel] = useState("");
const [rightLabel, setRightLabel] = useState("");
const [comparisonId, setComparisonId] = useState<string | null>(null);

// Derived from custom hooks
const poll = useComparisonPoll<CompareResult>(comparisonId);
const history = usePairHistory();
```

### 4.2 usePairHistory Hook (REQUIRED IMPLEMENTATION)

**Contract:**
```typescript
interface HistoryEntry {
  pairKey: string;
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  lastComparisonId?: string;
  lastRunAt: string;  // ISO 8601 timestamp
}

export function usePairHistory() {
  return {
    savePair: (entry: HistoryEntry) => void;
    listPairs: () => HistoryEntry[];
    getPair: (pairKey: string) => HistoryEntry | null;
    deletePair: (pairKey: string) => void;
  };
}
```

**Storage Strategy (LRU with Single Key):**
- Key: `localStorage["cf-env-history"]`
- Value: `HistoryEntry[]` (JSON array)
- Max: 20 entries
- On insert: Remove old entry (if exists), add new at front
- On insert: If length > 20, delete last (oldest)
- No per-pair keys; single atomic key prevents stale entries

**Invariant:** All operations are synchronous; no async IO to localStorage.

### 4.3 useComparisonPoll Hook (REQUIRED ENHANCEMENT)

**Contract:**
```typescript
export function useComparisonPoll<ResultT>(
  comparisonId: string | null,
  intervalMs?: number | number[],  // Support backoff: [500, 1000, 2000]
  maxAttempts?: number
) {
  return {
    status: "idle" | "running" | "completed" | "failed";
    result: ResultT | null;
    error: CompareError | null;      // ✅ TYPED (not string)
    progress?: string;                // Heuristic message
    elapsedMs?: number;               // Elapsed since poll start
  };
}
```

**Status Handling:**
- `"queued"` → treated as `"running"` (transient state, same UX)
- `"running"` → ongoing polling
- `"completed"` → result ready, stop polling
- `"failed"` → error set (with code for mapping)

**Heuristic Progress Messages:**
```typescript
const getHeuristicProgress = (elapsedMs: number): string => {
  if (elapsedMs < 2000) return "Initializing comparison…";
  if (elapsedMs < 5000) return "Probing environments…";
  if (elapsedMs < 8000) return "Analyzing drift & generating explanation…";
  if (elapsedMs > 10000) return "Taking longer than usual…";
  return "Processing…";
};
```

### 4.4 Local UI State (Components)

```typescript
// ResultDashboard.tsx
const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
const [filterCategory, setFilterCategory] = useState<FindingCategory | null>(null);
const [showRawData, setShowRawData] = useState(false);
```

**Invariant:** Keep component-level state minimal; derive as much as possible from props and hooks.

---

## 5. Error Handling & Guidance

### 5.1 Error Code Mapping (REQUIRED)

**Standard mapping table (from UI_IMPLEMENTATION_PLAN.md, Section 2.5):**

```typescript
interface ErrorGuidance {
  title: string;
  guidance: string;
}

const ERROR_GUIDANCE: Record<CompareErrorCode, ErrorGuidance> = {
  "invalid_request": {
    title: "Invalid Input",
    guidance: "Check that both URLs are formatted correctly (e.g., https://example.com/path)."
  },
  "invalid_url": {
    title: "Invalid URL Format",
    guidance: "Ensure both URLs are valid HTTP(S) addresses."
  },
  "ssrf_blocked": {
    title: "Private/Local Network Blocked",
    guidance: "Both URLs must be publicly accessible. Localhost, private IPs, and link-local addresses are not allowed."
  },
  "timeout": {
    title: "Request Timeout",
    guidance: "One or both URLs took too long to respond (>10s). Check that the servers are online."
  },
  "dns_error": {
    title: "DNS Resolution Failed",
    guidance: "One or both hostnames could not be resolved. Check the domain names."
  },
  "tls_error": {
    title: "TLS/HTTPS Error",
    guidance: "Certificate validation failed. Check that HTTPS is properly configured."
  },
  "fetch_error": {
    title: "Network Error",
    guidance: "A network error occurred. Check connectivity and try again."
  },
  "internal_error": {
    title: "Server Error",
    guidance: "An unexpected error occurred on the backend. Please try again or contact support."
  },
};

export function getErrorGuidance(error?: CompareError): ErrorGuidance | null {
  if (!error) return null;
  return ERROR_GUIDANCE[error.code] ?? {
    title: "Unknown Error",
    guidance: "Please try again.",
  };
}
```

**Invariant:** All error handling is human-readable; technical details (stack traces) are logged but never shown to users.

### 5.2 Graceful Degradation Chain

**For optional fields in DiffFinding:**
1. If `evidence[]` present: render evidence items
2. Else if `left_value` || `right_value` present: render "Left vs Right" comparison
3. Else: render raw finding JSON with explanation text

**Example:**
```typescript
const hasEvidence = finding.evidence?.length > 0;
const hasValues = finding.left_value !== undefined || finding.right_value !== undefined;

if (hasEvidence) {
  return <EvidenceList evidence={finding.evidence} />;
} else if (hasValues) {
  return <ValueComparison left={finding.left_value} right={finding.right_value} />;
} else {
  return <RawJSON data={finding} />;
}
```

---

## 6. Styling Guidelines

### 6.1 Color Scheme (Semantic)

| Severity | Color | Hex | Usage |
|----------|-------|-----|-------|
| 🔴 Critical | Red-600 | `#dc2626` | Finding badges, alerts |
| 🟠 Warn | Amber-500 | `#f59e0b` | Warning banners |
| 🔵 Info | Blue-500 | `#3b82f6` | Info badges |
| Neutral | Gray-100 | `#f3f4f6` | Backgrounds |
| Neutral | Gray-900 | `#1f2937` | Text |

### 6.2 Typography

| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| Heading 1 | 24px | Semibold (600) | Page title |
| Heading 2 | 20px | Semibold (600) | Section titles |
| Heading 3 | 18px | Semibold (600) | Subsection |
| Body | 16px | Regular (400) | Paragraph text |
| Small | 14px | Regular (400) | Secondary text |
| Mono | 14px | Regular (400) | Code, JSON |

### 6.3 Spacing Grid (8px base)

- `8px` — Minimal padding/margin
- `16px` — Standard spacing
- `24px` — Large spacing
- `32px` — Extra large spacing

### 6.4 CSS Modules Pattern (REQUIRED)

**File structure:**
```
components/
├── SummaryStrip.tsx
├── SummaryStrip.module.css
```

**Example (SummaryStrip.module.css):**
```css
.container {
  display: flex;
  gap: 16px;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background-color: #f9fafb;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 14px;
}

.badgeCritical {
  background-color: #fee2e2;
  color: #dc2626;
}

.badgeWarn {
  background-color: #fef3c7;
  color: #f59e0b;
}

.badgeInfo {
  background-color: #dbeafe;
  color: #3b82f6;
}
```

**Example (SummaryStrip.tsx):**
```typescript
import styles from "./SummaryStrip.module.css";

export const SummaryStrip: FC<SummaryStripProps> = ({ result }) => {
  return (
    <div className={styles.container}>
      <div className={`${styles.badge} ${styles.badgeCritical}`}>
        🔴 Critical
      </div>
      {/* ... more content ... */}
    </div>
  );
};
```

**Invariant:** All component styles must use CSS Modules with `.module.css` suffix. No inline `<style>` tags (except for dynamic theming, which is out of MVP scope).

### 6.5 Responsive Design (Mobile-First)

- **Mobile:** 320px–480px (default breakpoint 0)
- **Tablet:** 481px–1024px (use media query `@media (min-width: 481px)`)
- **Desktop:** 1025px+ (use media query `@media (min-width: 1025px)`)

**Example:**
```css
.container {
  display: grid;
  grid-template-columns: 1fr;  /* Mobile: single column */
  gap: 16px;
}

@media (min-width: 481px) {
  .container {
    grid-template-columns: 1fr 1fr;  /* Tablet/Desktop: two columns */
  }
}
```

---

## 7. Testing Requirements

### 7.1 Test Scope (MVP Priority)

**HIGH PRIORITY (Must Have):**
- usePairHistory: Save, list, LRU eviction
- useComparisonPoll: Transitions, backoff, error handling
- E2E happy path: Compare two URLs → See results

**MEDIUM PRIORITY (Should Have):**
- SummaryStrip: Renders without crash
- ExplanationPanel: Graceful null handling
- ErrorBanner: Error code mapping

**LOW PRIORITY (Nice to Have):**
- FindingsList: Category grouping
- RawDataView: JSON expansion
- Accessibility: a11y spot-check

### 7.2 Test Patterns

**Hook Test Example:**
```typescript
describe("usePairHistory", () => {
  it("saves and retrieves pairs", () => {
    const { result } = renderHook(() => usePairHistory());
    const entry: HistoryEntry = { /* ... */ };
    act(() => result.current.savePair(entry));
    expect(result.current.listPairs()).toContain(entry);
  });

  it("enforces LRU eviction at 20 entries", () => {
    // Add 21 entries, verify last is deleted
  });
});
```

**E2E Test Example (Playwright):**
```typescript
test("User can compare two URLs and see results", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await page.fill('input[placeholder*="Left URL"]', "https://example.com");
  await page.fill('input[placeholder*="Right URL"]', "https://api.example.com");
  await page.click("button:has-text('Compare')");
  await page.waitForSelector("text=Probing environments");
  await page.waitForSelector("text=Critical");
  expect(await page.locator("text=STATUS").isVisible()).toBe(true);
});
```

---

## 8. Prohibited Actions (Enforcement)

**MUST NEVER:**
- ⛔️ Add CSS frameworks (Tailwind, Bootstrap, etc.)
- ⛔️ Use `any` type without explicit comment + justification
- ⛔️ Duplicate types from `@shared/` in local code
- ⛔️ Import from sibling directories (use `@shared/` alias)
- ⛔️ Store comparison state in component memory (use DO + hooks)
- ⛔️ Assume optional fields exist (always use optional chaining)
- ⛔️ Render raw JSON objects without keys (always iterate arrays)
- ⛔️ Use relative paths for `@shared/*` imports
- ⛔️ Add Redux, Zustand, or centralized state libraries
- ⛔️ Cache Durable Object stub references across requests

---

## 9. Code Review Checklist

Before merging any PR, verify:

- [ ] No new CSS framework imports
- [ ] All types imported from `@shared/` with alias
- [ ] Zero `any` types (or justified + commented)
- [ ] Component props typed with @shared contracts
- [ ] usePairHistory used for persistence (not custom localStorage)
- [ ] useComparisonPoll supports backoff array
- [ ] Error handling uses ERROR_GUIDANCE mapping
- [ ] Optional fields use graceful degradation chain
- [ ] CSS Modules used (not inline `<style>` tags)
- [ ] Responsive layout tested (mobile, tablet, desktop)
- [ ] No sibling imports across `src/components` and `src/hooks`
- [ ] `npm run type-check` passes (zero errors)
- [ ] E2E happy path tested with real backend

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **CompareResult** | Top-level result from backend (left, right, diff, explanation) |
| **DiffFinding** | Individual difference (category, severity, evidence) |
| **EnvDiff** | Structured diff from two SignalEnvelopes |
| **SignalEnvelope** | Normalized HTTP probe result |
| **LlmExplanation** | AI-generated summary + ranked causes + actions |
| **FindingCategory** | Classification of diff (routing, security, cache, etc.) |
| **Severity** | Finding importance (critical, warn, info) |
| **pairKey** | Deterministic identifier for URL pair |
| **HeurísticProgress** | Time-based UX messaging during polling |

---

## Appendix: tsconfig Path Alias Configuration

**pages/tsconfig.app.json:**
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  }
}
```

**pages/vite.config.ts:**
```typescript
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
});
```

---

**DOCUMENT AUTHORITY:** This constitution is the law of the frontend. Any deviation requires explicit written approval from the project lead and must be documented in a revision to this file.
