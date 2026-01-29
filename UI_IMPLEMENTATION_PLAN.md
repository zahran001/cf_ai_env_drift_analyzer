# Comprehensive UI Implementation Plan (MVP)
**cf_ai_env_drift_analyzer**

**Date:** 2026-01-28
**Status:** Planning Phase
**Scope:** React frontend for environment comparison and drift analysis
**Target Delivery:** 1–2 weeks (phased approach)

---

## Executive Summary

This plan transforms the current minimal App.tsx (65 lines, raw JSON dump) into a **polished MVP UI** that faithfully implements the design from [Phase-UI-Docs/Design/](./Phase-UI-Docs/Design/) while respecting the `CLAUDE.md` architecture and phase-locked backend API.

**Current State:** Phase 1 (polling logic) complete; Phases 2–3 (storage, components) missing.

**Critique Status (2026-01-29):** All 5 issues resolved + 3 decisions finalized:
- ✅ "queued" status handling (HIGH) — fold into "running"
- ✅ CompareError type lost in hook (MEDIUM) — now properly typed
- ✅ LlmExplanation type missing (MEDIUM) — promoted to @shared/llm.ts
- ✅ Tailwind contradiction (MEDIUM) — fixed checklist
- ✅ Broken doc reference (LOW) — updated to Phase-UI-Docs/Design/
- ✅ @shared path alias (DECISION A) — configured in tsconfig + vite
- ✅ LLM explanation typing (DECISION A) — uses @shared/llm.ts
- See [Critique Resolution Guide](#critique-resolution-notes) below

**Outcome:** A professional, fully-typed React application with:
- ✅ Environment pair management with persistent history
- ✅ Heuristic progress messaging during polls
- ✅ 4-layer dashboard (Summary → Narrative → Evidence → Forensics)
- ✅ Graceful error handling with human-readable guidance
- ✅ Full TypeScript type safety using backend contracts

---

## Critique Resolution Notes (2026-01-29)

### Issues Resolved

**Issue #1 (HIGH): "queued" Status Not Handled** ✅
- **Problem:** Backend returns "queued" status, but hook treated it as "completed"
- **Fix:** `useComparisonPoll.ts` now treats "queued" → "running" (Decision A)
- **Impact:** Proper status display; heuristic progress messaging covers queuing phase

**Issue #2 (MEDIUM): CompareError Type Lost** ✅
- **Problem:** Hook stored error as `string | null`, losing error codes for mapping
- **Fix:** `useComparisonPoll.ts:8` now typed as `error: CompareError | null`
- **Impact:** ErrorBanner can now map error.code → human guidance

**Issue #3 (MEDIUM): LlmExplanation Type Missing** ✅
- **Problem:** Type didn't exist in @shared/; plan expected it
- **Fix:** Created `shared/llm.ts` with LlmExplanation + RankedCause + RecommendedAction types
- **Impact:** Full type safety for explanation rendering in ExplanationPanel

**Issue #4 (MEDIUM): Tailwind Contradiction** ✅
- **Problem:** Line 560 forbade Tailwind, line 645 checklist added it
- **Fix:** Updated Phase 3H checklist to explicitly require CSS Modules only
- **Impact:** Clear implementation guidance; no accidental dependency changes

**Issue #5 (LOW): Broken Design Reference** ✅
- **Problem:** Plan referenced non-existent `UI_Design.md`
- **Fix:** Updated line 13 to point to `Phase-UI-Docs/Design/`
- **Impact:** Developers can find design source-of-truth immediately

### Configuration Changes Deployed

**@shared Path Alias (Decision A)** ✅
- Updated `pages/tsconfig.app.json`: Added `paths: { "@shared/*": ["../shared/*"] }`
- Updated `pages/vite.config.ts`: Added Vite resolver alias via `fileURLToPath`
- Updated imports in `pages/src/lib/api.ts` and `pages/src/hooks/useComparisonPoll.ts` to use `@shared/api`
- **Result:** Clean, maintainable imports; refactor-safe

**LLM Explanation Typing (Decision A)** ✅
- Created `shared/llm.ts` with structured types:
  - `LlmExplanation` — top-level response
  - `RankedCause` — { cause, confidence, evidence }
  - `RecommendedAction` — { action, why }
- Updated `shared/api.ts` CompareResult to include `explanation?: unknown` (ready for B3 to fill with LlmExplanation)
- **Result:** Type-safe UI components; matches CLAUDE.md shared type principle

**"queued" Status Handling (Decision A)** ✅
- Updated `useComparisonPoll.ts:54` to check `if (resp.status === "running" || resp.status === "queued")`
- Folded into "running" state → single UI progress track
- Added comment explaining rationale (heuristic messaging already covers it)
- **Result:** Simpler UX; transparent to backend queue state

### No Breaking Changes

All fixes are **backward-compatible**:
- Existing hook callers still receive `{ status, result, error }` object (shape unchanged)
- Only type of `error` field changed (string → CompareError) — proper types only
- New @shared types are additions to existing contracts (no removals)
- Components can safely cast `result.explanation` to `LlmExplanation` when B3 is ready

---

## Part 1: Shortlist – Core Implementation Priorities

### Tier 1: MVP-Critical (Week 1)
**These must ship for functional MVP:**

| # | Feature | Lines | Est. Time | Rationale |
|---|---------|-------|-----------|-----------|
| **1a** | Label inputs + CompareRequest support | 20 | 1 hour | Design requirement; unblock history |
| **1b** | `usePairHistory()` hook (localStorage CRUD) | 150 | 3 hours | Required for re-run affordance + history |
| **1c** | Polling backoff strategy | 30 | 1 hour | Design requirement; improve UX |
| **1d** | Heuristic progress messaging | 50 | 2 hours | Design requirement; UX clarity |
| **1e** | Error code mapping + human guidance | 80 | 2 hours | Design requirement; UX polish |
| **1f** | SummaryStrip component | 120 | 3 hours | Dashboard layer 0; critical for result display |
| **1g** | FindingsList component | 150 | 4 hours | Dashboard layer 2; groups findings by category |
| **1h** | FindingDetailView (modal/expansion) | 100 | 2 hours | Dashboard layer 3; proof/evidence |

**Tier 1 Total:** ~700 LOC, ~18 hours → **~2 developer days**

---

### Tier 2: Polish & Type Safety (Week 1–2)
**Completes design implementation:**

| # | Feature | Lines | Est. Time | Rationale |
|---|---------|-------|-----------|-----------|
| **2a** | ExplanationPanel component (LLM output) | 120 | 3 hours | Dashboard layer 1; grounded explanation |
| **2b** | RawDataView (collapsible JSON) | 80 | 2 hours | Dashboard layer 3 (forensics) |
| **2c** | Swap button + preflight SSRF warnings | 60 | 1.5 hours | Design UX affordances |
| **2d** | Type SafetyFix (`CompareResult` typing) | 40 | 1 hour | Component type safety |
| **2e** | Styling + responsive layout | 200 | 4 hours | Professional appearance |
| **2f** | Loading skeleton / placeholders | 80 | 2 hours | Polish + perceived performance |
| **2g** | Re-run button + result caching | 50 | 1.5 hours | Design affordance |

**Tier 2 Total:** ~630 LOC, ~15 hours → **~1.5 developer days**

---

### Tier 3: Optional (Phase 2)
**Deferred for post-MVP iteration:**

- Advanced filtering (by severity, category)
- Search/export functionality
- Diff highlighting (left/right value comparison)
- Keyboard shortcuts
- Dark mode
- Analytics/metrics dashboard
- Webhook integrations

---

## Part 2: Architecture & Design Decisions

### 2.1 Component Hierarchy

```
<App />
├─ <ControlPlane />                   [Inputs, labels, swap, submit]
│  ├─ <UrlInput /> (×2)               [With optional SSRF preflight]
│  ├─ <LabelInput /> (×2)             [Optional, UI-only]
│  └─ <SwapButton />
│
├─ <ProgressIndicator />              [Heuristic messaging, polling status]
│
├─ <ErrorBanner />                    [Error code → human guidance mapping]
│
└─ <ResultDashboard />                [Conditional: only when result ready]
   ├─ <SummaryStrip />                [Max severity, count, codes, durations]
   ├─ <ExplanationPanel />            [LLM ranked_causes + actions]
   ├─ <FindingsList />                [Grouped by category, expandable]
   │  └─ <FindingItem />              [Single finding with severity badge]
   │     └─ <FindingDetailView />     [Modal/expansion: left vs right]
   └─ <RawDataView />                 [Collapsible JSON (left, right, diff)]
```

### 2.2 State Management Strategy

**No external state library.** React built-in `useState` + custom hooks:

```typescript
// Root state (App.tsx)
const [leftUrl, setLeftUrl] = useState("");
const [rightUrl, setRightUrl] = useState("");
const [leftLabel, setLeftLabel] = useState("");
const [rightLabel, setRightLabel] = useState("");
const [comparisonId, setComparisonId] = useState<string | null>(null);

// Derived from useComparisonPoll
const poll = useComparisonPoll<CompareResult>(comparisonId);

// Derived from usePairHistory
const history = usePairHistory();

// Local UI state
const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
const [filterCategory, setFilterCategory] = useState<FindingCategory | null>(null);
```

**Rationale:** MVP scope doesn't require Redux/Zustand complexity. Hooks provide clean separation.

---

### 2.3 Data Flow

```
1. User enters URLs + optional labels
   ↓
2. Click "Compare" → Validate + Preflight SSRF warnings
   ↓
3. POST /api/compare → Get comparisonId
   ↓
4. Poll GET /api/compare/:id (backoff: 500ms → 1s → 2s)
   ↓
5. Show heuristic progress: "Initializing..." → "Probing..." → "Analyzing..."
   ↓
6. Backend returns { status: "completed", result: CompareResult }
   ↓
7. Render dashboard:
   - SummaryStrip (max severity, findings count)
   - ExplanationPanel (if explanation present)
   - FindingsList (with category grouping)
   - RawDataView (forensics)
   ↓
8. Save to localStorage (usePairHistory)
   ↓
9. User can "Re-run" or "Last Run" affordances
```

---

### 2.4 Type Safety Contract

**All component props must be typed from `@shared/` contracts via the @shared/ path alias:**

```typescript
// ✅ CORRECT (with @shared/ alias configured)
import type { CompareResult, DiffFinding, Severity } from "@shared/api";
import type { SignalEnvelope, ProbeError } from "@shared/signal";
import type { EnvDiff } from "@shared/diff";
import type { LlmExplanation } from "@shared/llm";

interface SummaryStripProps {
  result: CompareResult;
  status: CompareStatus;
  error?: CompareError;
}

// ❌ WRONG
interface SummaryStripProps {
  result: any;  // No type safety
  severity: "critical" | "warn" | "info";  // Duplicated from @shared/
}
```

**⚠️ CRITICAL CONTRACT NOTES (Gotchas Fixed):**

1. **Findings source (Gotcha #2):** Findings ALWAYS come from `result.diff.findings[]` (not `result.findings[]`). Cast at top level:
   ```typescript
   const diff = result.diff as EnvDiff | undefined;
   const findings = diff?.findings ?? [];
   ```

2. **DiffFinding optional fields (Gotcha #1):** All are optional: `left_value?`, `right_value?`, `evidence?`, `recommendations?`. Use graceful fallback chain (see Section 3F).

3. **CompareResult fields are `unknown`:** In MVP, `result.left`, `result.right`, `result.diff` are `unknown` types. Cast when needed; always assume they may be undefined.

4. **No new frameworks (Gotcha #3):** Current setup has NO Tailwind/shadcn. Do NOT add them during MVP. Use CSS modules or inline CSS only.

5. **Categories are dynamic (Consistency #2):** FindingCategory has 7 values (routing, security, cache, content, timing, platform, unknown). Do NOT hardcode to 4 categories in filters.

---

### 2.5 Error Code Mapping

**Standard mapping table (used in ErrorBanner component):**

```typescript
const ERROR_GUIDANCE: Record<CompareErrorCode, { title: string; guidance: string }> = {
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
```

---

## Part 3: Detailed Implementation Roadmap

### Phase 3A: Input Layer & History (3 hours)

**Files to create/modify:**

#### `pages/src/hooks/usePairHistory.ts` (NEW)
```typescript
/**
 * Manages environment pair history in localStorage (Gotcha #4 Fix).
 *
 * Storage Strategy: Single-Key Append-Only Array with LRU
 * - Key: localStorage["cf-env-history"]
 * - Value: HistoryEntry[]
 * - Max 20 entries, LRU eviction
 * - On insert: check if exists; if yes, remove old; add new at front
 * - On insert: if length > 20, delete last (oldest)
 *
 * Why single key (not per-pair keys):
 * - Atomic operations (no index key needed)
 * - Simple LRU (just array reorder)
 * - No stale keys left behind
 */
export function usePairHistory() {
  // Methods:
  // - savePair(entry: HistoryEntry) — Add or update, maintain LRU order
  // - listPairs() → HistoryEntry[] — Retrieve all (MRU first)
  // - getPair(pairKey) → HistoryEntry | null
  // - deletePair(pairKey)
}
```

#### `pages/src/lib/api.ts` (MODIFY)
- Add `cache: 'no-store'` to poll request (design requirement)
- Ensure types import from `@shared/api`

#### `pages/src/App.tsx` (MODIFY)
- Add label inputs
- Integrate `usePairHistory()`
- Pass `leftLabel`, `rightLabel` in CompareRequest
- Show history as "Previous" or "Saved" pairs
- Implement migration from temp to real pairKey

**Deliverable:** Environment pairs persist; re-run affordance enabled.

---

### Phase 3B: Polling & Progress (3 hours)

#### `pages/src/hooks/useComparisonPoll.ts` (MODIFIED — Critique Fixes Applied)
```typescript
/**
 * Enhanced polling with backoff and proper error handling.
 *
 * CRITIQUE FIXES (2026-01-29):
 * - "queued" status now treated as "running" (backend contract issue #1)
 * - error field typed as CompareError | null, not string (issue #2)
 * - Enables proper error code mapping in ErrorBanner component
 */
export function useComparisonPoll<ResultT>(
  comparisonId: string | null,
  intervalMs?: number | number[],  // ✅ Support [500, 1000, 2000] backoff
  maxAttempts?: number
) {
  // Returns:
  // {
  //   status: "idle" | "running" | "completed" | "failed",
  //   result: ResultT | null,
  //   error: CompareError | null,    // ✅ CHANGED: was string | null
  //   progress?: string,              // Heuristic message
  //   elapsedMs?: number,             // Elapsed since poll start
  // }

  // Status handling:
  // - "queued" → treated as "running" (transient state, same UX)
  // - "running" → ongoing polling
  // - "completed" → result ready
  // - "failed" → error set (with code for mapping)
}
```

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

#### `pages/src/App.tsx` (MODIFY)
- Display progress message (replace static "Status: running")
- Implement backoff in polling call

**Deliverable:** Smooth progress UX during comparisons.

---

### Phase 3C: Dashboard Layer 0 — Summary (4 hours)

#### `pages/src/components/SummaryStrip.tsx` (NEW)
```typescript
/**
 * High-level overview of comparison results (Gotcha #2 Fix).
 *
 * Contract (from CompareResult):
 * - result.diff.findings[] (for count + max severity)  [NOT result.findings[]]
 * - result.left?.envelope.response (status, duration)  [optional]
 * - result.right?.envelope.response (status, duration) [optional]
 *
 * Type casting:
 * const diff = result.diff as EnvDiff | undefined;
 * const findings = diff?.findings ?? [];
 * const maxSeverity = diff?.maxSeverity ?? "info";
 */
interface SummaryStripProps {
  result: CompareResult;
  onFindingClick?: (findingId: string) => void;
}

// Display:
// ┌─────────────────────────────┐
// │ 🔴 Critical | 3 Findings    │
// │ Left: 200 (42ms) → Right: 404 (67ms) │
// └─────────────────────────────┘
```

**Sub-components:**
- `SeverityBadge` (color-coded: critical, warn, info)
- `StatusCodeBadge` (HTTP status + duration)

**Deliverable:** Users see result summary at a glance.

---

### Phase 3D: Dashboard Layer 1 — Explanation (3 hours)

#### `pages/src/components/ExplanationPanel.tsx` (NEW — Critique Fix #3 Applied)
```typescript
/**
 * LLM-generated explanation.
 *
 * Contract (from CompareResult):
 * - explanation?: LlmExplanation  // Type now defined in @shared/llm.ts
 *
 * CRITIQUE FIX (2026-01-29):
 * - LlmExplanation type promoted to @shared/ (was undefined)
 * - Full type safety from shared contract
 * - Graceful degradation if explanation is null
 *
 * Graceful degradation:
 * - If no explanation: show "Explanation unavailable" banner
 * - Still render other dashboard layers
 */
interface ExplanationPanelProps {
  explanation?: LlmExplanation;  // Optional; may be null if LLM call failed
}

// Display:
// ┌─────────────────────────────┐
// │ Summary                     │
// │ [Ranked Causes]             │
// │ [Recommended Actions]       │
// └─────────────────────────────┘
```

**Sub-components:**
- `ConfidenceBar` (0–100% visual indicator for each cause)
- `CauseItem` (cause text + evidence highlights)
- `ActionItem` (action text + reasoning)

**Deliverable:** Grounded AI explanation visible and well-formatted.

---

### Phase 3E: Dashboard Layer 2 — Findings List (4 hours)

#### `pages/src/components/FindingsList.tsx` (NEW)
```typescript
/**
 * Categorized list of deterministic findings (Gotcha #2 Fix).
 *
 * Contract (from CompareResult):
 * - result.diff.findings[] { id, code, category, severity, message, ... }
 *   [NOT result.findings[]]
 */
interface FindingsListProps {
  findings: DiffFinding[];
  expandedId?: string | null;
  onExpandClick?: (findingId: string) => void;
}

// Features:
// - Group by category dynamically (all FindingCategory values: routing, security, cache, content, timing, platform, unknown)
// - Do NOT hardcode to 4 categories (Consistency #2 Fix)
// - Sort by severity (critical → warn → info)
// - Expandable rows show detail
```

**Sub-components:**
- `FindingItem` (single row: severity badge + code + message)
- `CategoryGroup` (collapsible section per category)
- `SeverityIcon` (🔴 critical, 🟠 warn, 🔵 info)

**Deliverable:** Findings organized and easy to scan.

---

### Phase 3F: Dashboard Layer 3 — Detail & Forensics (4 hours)

#### `pages/src/components/FindingDetailView.tsx` (NEW)
```typescript
/**
 * Expanded view of a single finding (Gotcha #1 Fix).
 *
 * Contract (from DiffFinding, all fields OPTIONAL):
 * - evidence? DiffEvidence[] — Structured proof points
 * - left_value?, right_value? unknown — Raw values for comparison
 * - recommendations? string[] — Actionable next steps
 *
 * Graceful Degradation Chain:
 * 1. If evidence[] present: render evidence items
 * 2. Else if left_value || right_value present: render "Left vs Right" comparison
 * 3. Else: collapse raw finding JSON with explanation text
 */
interface FindingDetailViewProps {
  finding: DiffFinding;
  onClose?: () => void;
}

// Implementation:
// const hasEvidence = finding.evidence?.length > 0;
// const hasValues = finding.left_value !== undefined || finding.right_value !== undefined;
// return hasEvidence ? <EvidenceList /> : hasValues ? <ValueComparison /> : <RawJSON />;

// Display (Modal or Expansion):
// ┌─────────────────────────────┐
// │ CORS_HEADER_DRIFT           │
// │ Access-Control-Allow-Origin │
// │                             │
// │ Left:  *                    │
// │ Right: https://example.com  │
// │                             │
// │ Evidence: (if present)      │
// │ - Left response includes... │
// │ - Right response includes...│
// │                             │
// │ Recommendation: (if present)│
// │ Align CORS policies...      │
// └─────────────────────────────┘
```

#### `pages/src/components/RawDataView.tsx` (NEW)
```typescript
/**
 * Collapsible JSON views for full transparency.
 *
 * Contract (from CompareResult):
 * - left: SignalEnvelope
 * - right: SignalEnvelope
 * - diff: EnvDiff
 */
interface RawDataViewProps {
  left?: SignalEnvelope;
  right?: SignalEnvelope;
  diff?: EnvDiff;
}

// Display:
// ▼ Left Probe (JSON)
// ▼ Right Probe (JSON)
// ▼ Diff (JSON)
```

**Deliverable:** Power users can inspect raw data for debugging.

---

### Phase 3G: Control Plane & Error Handling (3 hours)

#### `pages/src/components/ControlPlane.tsx` (NEW)
```typescript
/**
 * Input header: URLs, labels, swap button, submit (Consistency #1 Fix).
 */
interface ControlPlaneProps {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  onSubmit: (req: CompareRequest) => void;
  isLoading: boolean;
}

// Features:
// - Swap button (swaps both URLs and labels)
// - Client-side preflight warning + submit disable for localhost/private IPs
//   (Backend is authoritative; frontend is UX sugar only)
// - Disable submit if invalid
```

#### `pages/src/components/ErrorBanner.tsx` (NEW)
```typescript
/**
 * Maps error codes to human-readable guidance.
 */
interface ErrorBannerProps {
  error?: CompareError;
}

// Display:
// ┌─────────────────────────────┐
// │ 🔴 Private/Local Network Blocked
// │ Both URLs must be publicly  │
// │ accessible. Localhost and   │
// │ private IPs are not allowed.│
// │                [Dismiss]    │
// └─────────────────────────────┘
```

**Deliverable:** Clear, actionable error messages.

---

### Phase 3H: Styling & Polish (4 hours)

**Approach:** Minimal, clean design with semantic HTML + CSS modules or inline CSS (Gotcha #3 Fix)

**🎨 Styling Constraints:**
- ✅ CSS Modules (Vite supports natively)
- ✅ Inline styles (React style prop)
- ✅ Plain CSS files
- ❌ NO Tailwind (not in package.json, do not add)
- ❌ NO shadcn/ui (not in package.json, do not add)
- ❌ NO CSS-in-JS library (emotion, styled-components)

**Why:** MVP scope, minimal deps, fast iteration. If Phase 2 wants Tailwind, do deliberate refactor AFTER MVP is stable.

**Color Scheme:**
- 🔴 Critical: `#dc2626` (red-600)
- 🟠 Warn: `#f59e0b` (amber-500)
- 🔵 Info: `#3b82f6` (blue-500)
- Neutral: `#f3f4f6` (gray-100), `#1f2937` (gray-900)

**Typography:**
- Headings: 18–24px, semibold
- Body: 14–16px, regular
- Monospace: Code samples, JSON

**Spacing:** 8px grid (8, 16, 24, 32, …)

**Components to style:**
1. SummaryStrip — card-like with badge
2. ExplanationPanel — collapsible sections
3. FindingsList — table-like rows with expand arrows
4. FindingDetailView — modal with scroll
5. RawDataView — collapsible code blocks
6. ErrorBanner — alert box
7. ProgressIndicator — spinner + text

**Optional:** Use `lucide-react` for icons (ChevronDown, AlertCircle, CheckCircle, etc.)

**Deliverable:** Professional-looking, readable UI.

---

## Part 4: Implementation Checklist

### Week 1: Core Functionality

- [ ] **Phase 3A:** usePairHistory hook + label inputs
  - [ ] Create `pages/src/hooks/usePairHistory.ts`
  - [ ] Add label inputs to App.tsx
  - [ ] Implement localStorage CRUD with LRU eviction
  - [ ] Test pair persistence across page reloads

- [ ] **Phase 3B:** Polling backoff + heuristic progress
  - [ ] Modify useComparisonPoll to support backoff strategy
  - [ ] Add progress messaging based on elapsed time
  - [ ] Update App.tsx to display progress hints
  - [ ] Test with real backend (verify messaging timeline)

- [ ] **Phase 3C:** SummaryStrip component
  - [ ] Create `pages/src/components/SummaryStrip.tsx`
  - [ ] Render severity badge, findings count, status codes, durations
  - [ ] Add SeverityBadge sub-component
  - [ ] Test with sample CompareResult data

- [ ] **Phase 3D:** ExplanationPanel component
  - [ ] Create `pages/src/components/ExplanationPanel.tsx`
  - [ ] Render summary, ranked causes, actions
  - [ ] Add ConfidenceBar visual
  - [ ] Handle missing/null explanation gracefully

- [ ] **Phase 3E:** FindingsList + FindingItem
  - [ ] Create `pages/src/components/FindingsList.tsx`
  - [ ] Implement category grouping (routing, security, cache, etc.)
  - [ ] Render findings sorted by severity
  - [ ] Add expandable detail toggles

- [ ] **Phase 3F:** FindingDetailView + RawDataView
  - [ ] Create `pages/src/components/FindingDetailView.tsx`
  - [ ] Show left vs right values with evidence
  - [ ] Create `pages/src/components/RawDataView.tsx`
  - [ ] Implement collapsible JSON blocks

- [ ] **Phase 3G:** ControlPlane + ErrorBanner
  - [ ] Create `pages/src/components/ControlPlane.tsx`
  - [ ] Implement swap button logic
  - [ ] Add SSRF preflight warning helper
  - [ ] Create `pages/src/components/ErrorBanner.tsx`
  - [ ] Build error code → guidance mapping table

- [ ] **Phase 3H:** Styling (CSS Modules or Inline only — NO Tailwind)
  - [ ] Add global CSS (normalize, base typography)
  - [ ] Create CSS Modules for each component
  - [ ] Ensure responsive layout (mobile, tablet, desktop)
  - [ ] Test color contrast (a11y)

### Week 1–2: Integration & Testing

- [ ] Wire all components into App.tsx
  - [ ] ControlPlane → handleSubmit
  - [ ] ProgressIndicator (during poll)
  - [ ] ErrorBanner (on error)
  - [ ] ResultDashboard (on completion)
    - [ ] SummaryStrip
    - [ ] ExplanationPanel
    - [ ] FindingsList
    - [ ] RawDataView

- [ ] End-to-end testing
  - [ ] Test with real API (backend running on 8787)
  - [ ] Verify polling progress messages
  - [ ] Verify finding detail expansion
  - [ ] Verify error guidance display
  - [ ] Verify history persistence

- [ ] Type safety pass
  - [ ] No `any` types in components
  - [ ] All props typed from `@shared/`
  - [ ] Run `npm run type-check` (zero errors)

- [ ] Documentation
  - [ ] Update `README.md` with UI feature list
  - [ ] Add inline JSDoc comments for complex components
  - [ ] Document component props and state

---

## Part 5: Testing Strategy (Gotcha #6 Fix – Realistic Scope)

### Week 1: Minimal Tests (Prevent Obvious Breaks)

**High-ROI tests only:**

#### Hook Tests (~2 hours)
- `usePairHistory.test.ts` — savePair() stores, listPairs() retrieves, LRU evicts
- `useComparisonPoll.test.ts` — transitions idle → running → completed (including cancel())

#### Component Snapshot Test (~1 hour)
- `SummaryStrip.test.tsx` — Renders without crash with sample CompareResult

#### E2E Happy Path (~2 hours)
- Using Playwright or Cypress:
  ```typescript
  test("User can compare two URLs and see results", async ({ page }) => {
    await page.goto("http://localhost:5173");
    await page.fill('input[placeholder*="Left URL"]', "https://httpbin.org/status/200");
    await page.fill('input[placeholder*="Right URL"]', "https://httpbin.org/status/404");
    await page.click("button:has-text('Compare')");
    await page.waitForSelector("text=Analyzing drift");
    await page.waitForSelector("text=STATUS_MISMATCH");
    expect(page.locator("text=critical")).toBeTruthy();
  });
  ```

**Week 1 Time:** ~5h (fits in daily testing during development)

---

### Week 2: Expand Coverage (After MVP Stability)

**Additional tests (optional, non-blocking):**
- FindingsList: renders category groups
- ExplanationPanel: graceful null explanation
- ErrorBanner: maps error codes correctly
- E2E error paths: SSRF blocked, timeout, DNS error
- a11y spot-check: Tab order, color contrast, screen reader (manual + axe)

**Week 2 Time:** ~6h (optional, nice-to-have)

---

### Coverage Target: 50–60% (Realistic for MVP)

**NOT 75%+.** We'll achieve higher coverage in Phase 2 with planned refactors.

For MVP: **Prioritize E2E happy path + error paths.** Unit tests provide safety net only.

**Decision Point (Friday, Week 1):**
- If schedule pressure: skip unit tests, do E2E only.
- E2E catches integration bugs; unit tests are bonus.

---

## Part 6: Handoff & Acceptance Criteria

### Definition of Done

A feature is complete when:
1. ✅ Code reviewed (no `any` types, all imports from `@shared/`)
2. ✅ Unit tests passing (>80% coverage on new code)
3. ✅ E2E tested with real backend
4. ✅ Responsive on mobile, tablet, desktop
5. ✅ Error paths handled gracefully
6. ✅ Type-check passes: `npm run type-check` (zero errors)
7. ✅ Documented with JSDoc for public APIs

### Acceptance Tests (MVP Complete)

**A reviewer should be able to:**

1. ✅ Paste two URLs and click "Compare"
2. ✅ See heuristic progress messages ("Probing...", "Analyzing...")
3. ✅ View a summary (max severity, findings count, status codes)
4. ✅ Read an LLM-generated explanation (ranked causes, actions)
5. ✅ Explore individual findings (categorized, expandable, evidence shown)
6. ✅ Inspect raw probe + diff JSON for debugging
7. ✅ See human-readable error messages (e.g., "SSRF blocked", "timeout")
8. ✅ Save a comparison to browser history
9. ✅ Re-run a previous comparison with one click
10. ✅ Type safety verified: `npm run type-check` passes

---

## Part 7: Dependencies & Tech Stack

### Frameworks
- **React 19.2** (already in package.json)
- **Vite 7.2** (already in package.json)
- **TypeScript 5.x** (already in package.json)

### Optional Libraries (Recommended)

| Library | Purpose | Why | Est. Bundle Impact |
|---------|---------|-----|-------------------|
| `lucide-react` | Icons | Professional look, small | ~30KB |
| `clsx` | Conditional CSS classes | Cleaner styling logic | ~1KB |
| (none) | UI components | Keep it simple for MVP | — |

**Rationale:** No Tailwind, shadcn/ui, or other CSS frameworks in MVP. Use semantic HTML + inline CSS or simple CSS modules.

---

## Part 8: Risk Mitigation

### Risk 1: API Contract Changes
**If backend changes CompareResult structure:**
- Impact: Components break (prop types mismatch)
- Mitigation: Keep all props from `@shared/api` contracts; version the API (schema_version in SignalEnvelope)
- Fallback: Use `?.optional_chaining` for new fields; render "Data unavailable" gracefully

### Risk 2: LLM Output Inconsistent
**If LLM explanation is malformed/null:**
- Impact: ExplanationPanel crashes
- Mitigation: Always check `explanation?` before rendering; show "Explanation unavailable" banner
- Fallback: Still render deterministic findings (dashboard layers 0, 2, 3)

### Risk 3: localStorage Quota Exceeded
**If user has many saved pairs:**
- Impact: history.listPairs() fails; new saves fail
- Mitigation: Implement LRU eviction (delete oldest on insert if >20)
- Fallback: Graceful error message, allow user to clear history

### Risk 4: Performance: Large Finding List
**If result has 50+ findings:**
- Impact: Render lag, poor UX
- Mitigation: Paginate or virtual scroll (FindingsList)
- Fallback: Show first 10, add "Load more" button

### Risk 5: Type Safety Violations
**If component props use `any` type:**
- Impact: Runtime errors, hard to debug
- Mitigation: Enforce strict type checking in PR review; run `tsc --noEmit` pre-commit
- Fallback: Add `// @ts-expect-error` comment with explanation (rare)

---

## Part 9: Success Metrics

### User Experience Metrics
- **Time to result:** <15 seconds (including backend processing)
- **Clicks to detailed finding:** <3 clicks
- **Error clarity:** User understands error guidance without needing support

### Code Quality Metrics
- **Type coverage:** 100% (no `any` outside React.FC generics)
- **Component test coverage:** >75% for new components
- **Accessibility:** WCAG 2.1 AA (color contrast, keyboard nav)

### Business Metrics
- **Feature completeness:** All Tier 1 + Tier 2 features shipped
- **Design fidelity:** UI matches UI_Design.md spec
- **Deliverable:** MVP ready for user feedback / Phase 2

---

## Part 10: Timeline & Resource Allocation

### Recommended Schedule

| Week | Focus | Team | Hours/Day |
|------|-------|------|-----------|
| **Week 1, Mon–Wed** | Phases 3A–3B (Input + Polling) | 1 dev | 6/8 |
| **Week 1, Thu–Fri** | Phases 3C–3D (Summary + Explanation) | 1 dev | 6/8 |
| **Week 2, Mon–Tue** | Phases 3E–3F (Findings + Detail) | 1 dev | 6/8 |
| **Week 2, Wed–Thu** | Phase 3G–3H (Control + Error + Styling) | 1 dev | 6/8 |
| **Week 2, Fri** | Integration, E2E testing, bug fixes | 1 dev | 6/8 |

**Total:** ~40 developer-hours across 10 days → **~1.25 weeks** for 1 developer

### Parallel Path (If 2 developers available)
- **Dev 1:** Phases 3A, 3C, 3E, 3G (Input layer, Dashboard layers 0/2)
- **Dev 2:** Phases 3B, 3D, 3F, 3H (Polling, Dashboard layer 1, styling)
- **Both:** Integration + E2E testing (Fri)
- **Time:** ~5 days

---

## Part 11: Next Steps

### Immediate Actions (Today)
1. [ ] Share this plan with team
2. [ ] Get approval on feature priorities (Tier 1 vs Tier 2)
3. [ ] Assign developer(s) and confirm availability
4. [ ] Set up code review process (type safety enforcer)

### Kick-off (Tomorrow)
1. [ ] Create feature branch: `feature/ui-implementation-mvp`
2. [ ] Set up component stubs in `/pages/src/components/`
3. [ ] Create hook stubs in `/pages/src/hooks/`
4. [ ] Start with Phase 3A (usePairHistory)
5. [ ] Daily standup (15 min) to track blockers

### Code Review Checklist (Every PR)
- [ ] No `any` types (except where necessary + commented)
- [ ] All imports from `@shared/` for contracts
- [ ] Props destructured and typed
- [ ] Constants used for repeated strings (i18n out of scope for MVP)
- [ ] Unit tests added for critical logic (not 75% coverage, be pragmatic)
- [ ] Responsive layout tested (mobile, tablet, desktop)
- [ ] Error handling for missing/null fields (optional chaining, graceful fallbacks)
- [ ] Lint passes: `npm run lint` (if configured)
- [ ] Type check passes: `npm run type-check`
- [ ] No new frameworks added (no Tailwind, shadcn, CSS-in-JS)

---

## Part 12: Appendix – Reference Implementation Snippets

### A. Component Template

```typescript
// pages/src/components/MyComponent.tsx
import type { FC } from "react";
import type { CompareResult } from "@shared/api";  // ✅ Import from contracts
import type { DiffFinding } from "@shared/diff";

interface MyComponentProps {
  result: CompareResult;
  finding?: DiffFinding;
  onSelect?: (id: string) => void;
}

export const MyComponent: FC<MyComponentProps> = ({ result, finding, onSelect }) => {
  return (
    <div>
      {/* Component content */}
    </div>
  );
};
```

### B. Hook Template

```typescript
// pages/src/hooks/useMyHook.ts
import { useState, useCallback } from "react";
import type { CompareResult } from "@shared/api";

export function useMyHook() {
  const [data, setData] = useState<CompareResult | null>(null);

  const doSomething = useCallback(() => {
    // Logic here
  }, []);

  return { data, doSomething };
}
```

### C. Error Mapping Template

```typescript
import type { CompareErrorCode, CompareError } from "@shared/api";

const ERROR_GUIDANCE: Record<CompareErrorCode, { title: string; guidance: string }> = {
  "invalid_request": {
    title: "Invalid Input",
    guidance: "Check that both URLs are formatted correctly.",
  },
  // ... more error codes
};

export function getErrorGuidance(error?: CompareError) {
  if (!error) return null;
  return ERROR_GUIDANCE[error.code] ?? { title: "Unknown Error", guidance: "Please try again." };
}
```

### D. localStorage with LRU Example (Gotcha #4 Fix)

```typescript
// Single-Key Append-Only Array Strategy (NOT per-pair keys)

interface HistoryEntry {
  pairKey: string;
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  lastComparisonId?: string;
  lastRunAt: string;
}

const MAX_PAIRS = 20;
const STORAGE_KEY = "cf-env-history";  // Single key

export function savePair(entry: HistoryEntry) {
  const all = listPairs();

  // Remove if exists (to update order)
  const filtered = all.filter(p => p.pairKey !== entry.pairKey);

  // Add new entry at front
  const updated = [entry, ...filtered].slice(0, MAX_PAIRS);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function listPairs(): HistoryEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}
```

---

## Conclusion

This plan transforms the MVP from a minimal 65-line prototype into a **professional, fully-featured React application** while maintaining:
- ✅ 100% TypeScript type safety (no `any` types)
- ✅ Contract-locked design (imports from `@shared/`)
- ✅ Graceful degradation (missing fields handled)
- ✅ Clean separation of concerns (hooks, components, utilities)

**Estimated effort:** 40 developer-hours (~1.25 weeks for 1 dev, ~5 days for 2 devs)

**Ready to start?** Approve Tier 1 priorities and assign a developer. The first phase (input + history) is the quickest path to functional MVP.

---

**Document Version:** 1.0
**Last Updated:** 2026-01-28
**Status:** Ready for Review
