# UI Specifications — cf_ai_env_drift_analyzer

**Authority:** This document defines the complete component contract inventory for the frontend. Extracted from `../../UI_IMPLEMENTATION_PLAN.md` (Section 2.1 Component Hierarchy, Parts 3C–3G).

**Last Updated:** 2026-02-07
**Status:** MVP Blueprint (type contracts synced with shared/ on 2026-02-07)

---

## Source of Truth

- Implements: `../../UI_IMPLEMENTATION_PLAN.md` (Sections 2.1, 3C–3H)
- Design reference: `../../Phase-UI-Docs/Design/`
- Type contracts: `../../shared/{api,diff,signal,llm}.ts`

---

## 1. Component Inventory & Contracts

### 1.1 ControlPlane
**File:** `pages/src/components/ControlPlane.tsx`

**Purpose:** Input header for URLs, labels, swap button, and submit.

**Props:**
```typescript
interface ControlPlaneProps {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  onSubmit: (req: CompareRequest) => void;
  isLoading: boolean;
}
```

**Features:**
- ✅ Two URL input fields (left and right)
- ✅ Two optional label inputs (for environment names)
- ✅ Swap button (swaps URLs + labels bidirectionally)
- ✅ Submit button (disabled during loading)
- ✅ Client-side preflight warning for localhost/private IPs (UX sugar only; backend is authoritative)
- ✅ Form validation (both URLs required)

**Critical Rules:**
- No auto-submit; user must click "Compare" button explicitly
- Preflight warning must be visible but non-blocking (user can override)
- SSRF detection is CLIENT-SIDE ONLY; backend validates and rejects

**Rendering Constraint:**
- Single column on mobile (320–480px)
- Side-by-side on tablet+ (481px+)

---

### 1.2 ProgressIndicator
**File:** `pages/src/components/ProgressIndicator.tsx`

**Purpose:** Show polling progress with heuristic messaging.

**Props:**
```typescript
interface ProgressIndicatorProps {
  status: "idle" | "running" | "completed" | "failed";
  progress?: string;   // Heuristic message from useComparisonPoll
  elapsedMs?: number;
}
```

**Features:**
- ✅ Spinner or loading animation (CSS-only, no libraries)
- ✅ Progress text from `useComparisonPoll.getHeuristicProgress(elapsedMs)`
- ✅ Elapsed time display (e.g., "10.5s")
- ✅ Hide when status !== "running"

**Heuristic Messages:**
```
<2000ms:  "Initializing comparison…"
<5000ms:  "Probing environments…"
<8000ms:  "Analyzing drift & generating explanation…"
>10000ms: "Taking longer than usual…"
else:     "Processing…"
```

**Critical Rules:**
- Messages are TIME-BASED ONLY, not backend-driven
- No status polling on its own; receives status from parent
- Stop spinner once `status !== "running"`

---

### 1.3 ErrorBanner
**File:** `pages/src/components/ErrorBanner.tsx`

**Purpose:** Display human-readable error guidance.

**Props:**
```typescript
interface ErrorBannerProps {
  error?: CompareError;
  onDismiss?: () => void;
}
```

**Features:**
- ✅ Error code → human guidance mapping (from constitution.md Section 5.1)
- ✅ Bold title, descriptive guidance text
- ✅ Dismiss button (clears error from parent state)
- ✅ Color-coded border (red for critical errors)
- ✅ Hide when error is null

**Error Codes Mapped:**
- `invalid_request`, `invalid_url`, `ssrf_blocked`, `timeout`, `dns_error`, `tls_error`, `fetch_error`, `internal_error`

**Critical Rules:**
- NEVER show technical stack traces to users
- Guidance must be actionable (suggest checking URLs, connectivity, etc.)
- If error code unknown, show generic "Unknown Error" with "Please try again."

**Rendering Constraint:**
- Full width banner at top of page
- Above ControlPlane

---

### 1.4 SummaryStrip
**File:** `pages/src/components/SummaryStrip.tsx`

**Purpose:** High-level overview of comparison results (Dashboard Layer 0).

**Props:**
```typescript
interface SummaryStripProps {
  result: CompareResult;
  onFindingClick?: (findingId: string) => void;
}
```

**Features:**
- ✅ Max severity badge (🔴 Critical, 🟠 Warn, 🔵 Info)
- ✅ Findings count (e.g., "3 Findings")
- ✅ Left status code + duration (e.g., "200 (42ms)")
- ✅ Right status code + duration (e.g., "404 (67ms)")
- ✅ Arrow or divider between left/right

**Type Casting (CRITICAL):**
```typescript
// ✅ CORRECT: Findings come ONLY from result.diff.findings
const diff = result.diff as EnvDiff | undefined;
const findings = diff?.findings ?? [];
const maxSeverity = findings.length > 0
  ? findings.reduce((max, f) => compareSeverity(max, f.severity), "info" as Severity)
  : "info";

// ❌ WRONG: Do NOT use result.findings (doesn't exist)
```

**Sub-Components:**
- `SeverityBadge` — Color-coded severity indicator (critical=#dc2626, warn=#f59e0b, info=#3b82f6)
- `StatusCodeBadge` — HTTP status + duration in compact format

**Critical Rules:**
- Never assume `result.diff` exists; use optional chaining
- Always fallback to `"info"` if no findings
- Severity comparison must use deterministic order: critical > warn > info

---

### 1.5 ExplanationPanel
**File:** `pages/src/components/ExplanationPanel.tsx`

**Purpose:** Display LLM-generated explanation (Dashboard Layer 1).

**Props:**
```typescript
interface ExplanationPanelProps {
  explanation?: LlmExplanation;
}
```

**Features:**
- ✅ Summary text (from `explanation.summary`)
- ✅ Ranked causes section (from `explanation.ranked_causes[]`)
  - Cause text
  - Confidence bar (0–100% visual indicator)
  - Evidence highlights (bullet list)
- ✅ Recommended actions section (from `explanation.actions[]`)
  - Action text
  - Why reasoning
- ✅ Collapsible sections (for compact reading)
- ✅ Graceful degradation: Show "Explanation unavailable" if null

**Type Contract:**
```typescript
interface LlmExplanation {
  summary: string;
  ranked_causes: RankedCause[];
  actions: RecommendedAction[];
  notes?: string[];
}

interface RankedCause {
  cause: string;
  confidence: number;  // 0.0–1.0
  evidence: string[];
}

interface RecommendedAction {
  action: string;
  why: string;
}
```

**Sub-Components:**
- `ConfidenceBar` — Visual 0–100% bar for each cause
- `CauseItem` — Cause text + evidence list
- `ActionItem` — Action text + why reasoning

**Critical Rules:**
- Do NOT render if `explanation` is null/undefined
- Confidence must be displayed as percentage (multiply by 100)
- Evidence array may be empty; handle gracefully
- Actions section may be empty; show "No recommendations" if so

**Rendering Constraint:**
- Collapsible sections for mobile (expand/collapse arrows)
- Expand-all button on desktop

---

### 1.6 FindingsList
**File:** `pages/src/components/FindingsList.tsx`

**Purpose:** Categorized, sortable list of deterministic findings (Dashboard Layer 2).

**Props:**
```typescript
interface FindingsListProps {
  findings: DiffFinding[];
  expandedId?: string | null;
  onExpandClick?: (findingId: string) => void;
}
```

**Features:**
- ✅ Group by category dynamically (routing, security, cache, content, timing, platform, unknown)
- ✅ Sort by severity (critical → warn → info) WITHIN each category
- ✅ Expandable rows (click to expand, click again to collapse)
- ✅ Severity badge per finding (🔴 critical, 🟠 warn, 🔵 info)
- ✅ Finding code + short message
- ℹ️ Toggle behavior: Single-expand model (Phase 4+: multi-expand via Set<string> refactor)

**Type Contract:**
```typescript
interface DiffFinding {
  id: string;
  code: string;
  category: FindingCategory;  // 7 values: routing, security, cache, content, timing, platform, unknown
  severity: Severity;         // critical, warn, info
  message: string;
  left_value?: unknown;       // Optional
  right_value?: unknown;      // Optional
  evidence?: DiffEvidence[];  // Optional
  recommendations?: string[]; // Optional
}

type FindingCategory = "routing" | "security" | "cache" | "content" | "timing" | "platform" | "unknown";
type Severity = "critical" | "warn" | "info";
```

**Sub-Components:**
- `FindingItem` — Single row: severity badge + code + message + expand arrow
- `CategoryGroup` — Collapsible section per category with findings count
- `SeverityIcon` — Visual indicator for severity

**Critical Rules:**
- Do NOT hardcode category list to 4 values; use all 7 dynamically
- Always sort findings by severity (critical first)
- If no findings, show "No differences found" message
- Category order (display): routing, security, cache, content, timing, platform, unknown

**Rendering Constraint:**
- Table-like layout on desktop (full width)
- Stacked rows on mobile (single column)
- Each row expands inline (no modal) on click

---

### 1.7 FindingDetailView
**File:** `pages/src/components/FindingDetailView.tsx`

**Purpose:** Expanded view of single finding with evidence (Dashboard Layer 3).

**Props:**
```typescript
interface FindingDetailViewProps {
  finding: DiffFinding;
  onClose?: () => void;
}
```

**Features:**
- ✅ Finding code + category + severity (header)
- ✅ Message text
- ✅ Graceful degradation chain:
  1. If `evidence[]` present: render evidence items
  2. Else if `left_value` || `right_value`: render side-by-side comparison
  3. Else: render raw finding JSON
- ✅ Recommendations (if present)
- ✅ Close button or escape key handler

**Type Contract (Graceful Degradation) — Updated 2026-02-07:**
```typescript
// Actual DiffEvidence shape from shared/diff.ts
interface DiffEvidence {
  section: "status" | "finalUrl" | "headers" | "redirects" | "content" | "timing" | "cf" | "probe";
  keys?: string[];
  note?: string;
}

// All fields are OPTIONAL on DiffFinding
interface DiffFinding {
  evidence?: DiffEvidence[];    // Structured evidence (NOT string[])
  left_value?: unknown;
  right_value?: unknown;
  recommendations?: string[];
}
```

**Rendering Logic:**
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

**Sub-Components:**
- `EvidenceList` — Bullet list of evidence items (with source indicator)
- `ValueComparison` — Side-by-side left/right values (with JSON formatting)
- `RawJSON` — Syntax-highlighted JSON view of finding

**Critical Rules:**
- Never assume `evidence`, `left_value`, or `right_value` exist
- Always provide fallback rendering
- Use `<pre><code>` for JSON (syntax highlighting optional for MVP)

**Rendering Constraint:**
- Inline expansion (not modal) within FindingsList
- Or modal on demand (user chooses at implementation time)

---

### 1.8 RawDataView
**File:** `pages/src/components/RawDataView.tsx`

**Purpose:** Collapsible JSON views for full transparency (Dashboard Layer 3 Forensics).

**Props:**
```typescript
interface RawDataViewProps {
  left?: SignalEnvelope;
  right?: SignalEnvelope;
  diff?: EnvDiff;
}
```

**Features:**
- ✅ Three collapsible JSON blocks: "Left Probe", "Right Probe", "Diff"
- ✅ Syntax highlighting (optional for MVP, can use plain monospace)
- ✅ Copy-to-clipboard buttons per block
- ✅ Expand/collapse all button
- ✅ Pretty-printed JSON (2-space indent)

**Type Contract — Updated 2026-02-07 (from shared/signal.ts and shared/diff.ts):**
```typescript
// Actual SignalEnvelope from shared/signal.ts
interface SignalEnvelope {
  schemaVersion: 1;
  comparisonId: string;
  probeId: string;
  side: "left" | "right";
  requestedUrl: string;
  capturedAt: string;       // ISO 8601
  cf?: CfContextSnapshot;   // { colo?, country?, asn?, ... }
  result: ProbeResult;       // ProbeSuccess | ProbeResponseError | ProbeNetworkFailure
}

// Actual EnvDiff from shared/diff.ts
interface EnvDiff {
  schemaVersion: 1;
  comparisonId: string;
  leftProbeId: string;
  rightProbeId: string;
  probe: ProbeOutcomeDiff;
  status?: Change<number>;
  finalUrl?: Change<string>;
  headers?: { core: HeaderDiff; accessControl?: HeaderDiff };
  redirects?: RedirectDiff;
  content?: ContentDiff;
  timing?: TimingDiff;
  cf?: CfContextDiff;
  findings: DiffFinding[];
  maxSeverity: Severity;
}
```

**Sub-Components:**
- `JSONBlock` — Reusable collapsible JSON display (title, JSON, copy button)

**Critical Rules:**
- All three sections are optional; only render if data present
- Copy-to-clipboard should use navigator.clipboard.writeText()
- Indent JSON with 2 spaces (use `JSON.stringify(obj, null, 2)`)

**Rendering Constraint:**
- Monospace font (14px, gray-800 text color)
- Dark background (gray-100 or lighter) for contrast
- Horizontal scroll on mobile if JSON wide

---

### 1.9 ResultDashboard
**File:** `pages/src/components/ResultDashboard.tsx`

**Purpose:** Parent container for all dashboard layers (shown only when comparison completed).

**Props:**
```typescript
interface ResultDashboardProps {
  result: CompareResult;
  status: CompareStatus;
}
```

**Features:**
- ✅ Conditional rendering (only show when status === "completed")
- ✅ Compose all dashboard layers:
  1. SummaryStrip (Layer 0)
  2. ExplanationPanel (Layer 1, if explanation present)
  3. FindingsList (Layer 2)
  4. RawDataView (Layer 3, collapsible)
- ✅ Tab or accordion navigation (optional for MVP; can be linear scroll)

**Critical Rules:**
- Do NOT render if `status !== "completed"`
- Render even if explanation is null (graceful degradation)
- Render findings list always (unless empty)

**Rendering Constraint:**
- Vertical stack on mobile
- Sidebar-aware layout on tablet/desktop (findings list on left, detail on right)

---

### 1.10 App
**File:** `pages/src/App.tsx`

**Purpose:** Root component orchestrating entire flow.

**State:**
```typescript
const [leftUrl, setLeftUrl] = useState("");
const [rightUrl, setRightUrl] = useState("");
const [leftLabel, setLeftLabel] = useState("");
const [rightLabel, setRightLabel] = useState("");
const [comparisonId, setComparisonId] = useState<string | null>(null);
const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

// Hooks
const poll = useComparisonPoll<CompareResult>(comparisonId);
const history = usePairHistory();
```

**Data Flow:**
1. User enters URLs + optional labels in ControlPlane
2. User clicks "Compare" → `handleSubmit()`
3. `handleSubmit()` validates, posts to `/api/compare`, receives `comparisonId`
4. `setComparisonId()` triggers polling
5. `useComparisonPoll` polls `GET /api/compare/:id` every [500ms, 1s, 2s] until status !== "running"
6. On completion, render ResultDashboard with result
7. Save to history via `history.savePair()`

**Critical Rules:**
- No auto-fetch on mount; wait for user action
- Pass `comparisonId` to polling hook (triggers polling)
- Handle error state gracefully (show ErrorBanner)
- Save to history only on successful completion

---

## 2. Critical Data Flow Rules

### 2.1 Polling Flow
```
App.tsx receives comparisonId from POST /api/compare
    ↓
useComparisonPoll(comparisonId) starts polling GET /api/compare/:id
    ↓
Status transitions: idle → running → completed | failed
    ↓
On completed: render ResultDashboard
On failed: show ErrorBanner
```

**Invariant:** Polling MUST handle "queued" status as "running" (transient state, same UX).

### 2.2 Finding Expansion
```
User clicks FindingItem in FindingsList
    ↓
onClick sets expandedId in local state
    ↓
FindingDetailView renders (inline or modal)
    ↓
User clicks close button or clicks another row
    ↓
setExpandedId(null) collapses detail view
```

**Invariant:** Expansion is CLIENT-SIDE ONLY; no refetch needed.

### 2.3 Error Handling
```
Backend returns { status: "failed", error: CompareError }
    ↓
useComparisonPoll returns error typed as CompareError (not string)
    ↓
ErrorBanner component receives error
    ↓
ERROR_GUIDANCE mapping displays title + guidance
    ↓
User clicks dismiss → onDismiss() clears error from App state
```

**Invariant:** Error codes MUST map to human-readable guidance (no stack traces).

### 2.4 History & Re-run
```
User completes comparison
    ↓
App.tsx calls history.savePair({ pairKey, leftUrl, rightUrl, leftLabel?, rightLabel?, lastComparisonId, lastRunAt })
    ↓
usePairHistory stores in localStorage["cf-env-history"] (single key, LRU)
    ↓
Previous runs shown in ControlPlane or separate sidebar
    ↓
User clicks "Re-run" → Same URLs/labels auto-filled, user clicks Compare
```

**Invariant:** History is APPEND-ONLY; max 20 entries with LRU eviction.

---

## 3. Component Hierarchy (Complete)

```
<App />
├─ <ControlPlane />
│  ├─ <UrlInput /> (×2)
│  ├─ <LabelInput /> (×2)
│  └─ <SwapButton />
│
├─ <ProgressIndicator />
│
├─ <ErrorBanner />
│
└─ <ResultDashboard />  [conditional: status === "completed"]
   ├─ <SummaryStrip />
   │  ├─ <SeverityBadge />
   │  └─ <StatusCodeBadge />
   │
   ├─ <ExplanationPanel />
   │  ├─ <ConfidenceBar /> (×N)
   │  ├─ <CauseItem /> (×N)
   │  └─ <ActionItem /> (×N)
   │
   ├─ <FindingsList />
   │  ├─ <CategoryGroup /> (×7)
   │  │  └─ <FindingItem /> (×M)
   │  │     └─ <FindingDetailView /> [conditional: expandedId === finding.id]
   │  │        ├─ <EvidenceList />
   │  │        ├─ <ValueComparison />
   │  │        └─ <RawJSON />
   │  │
   │  └─ <FindingDetailView /> [modal alternative]
   │     ├─ <EvidenceList />
   │     ├─ <ValueComparison />
   │     └─ <RawJSON />
   │
   └─ <RawDataView />
      └─ <JSONBlock /> (×3: left, right, diff)
```

---

## 4. Styling & Visual Guidelines

### 4.1 Color Tokens
- **Critical:** `#dc2626` (red-600)
- **Warn:** `#f59e0b` (amber-500)
- **Info:** `#3b82f6` (blue-500)
- **Background:** `#f3f4f6` (gray-100)
- **Text:** `#1f2937` (gray-900)
- **Border:** `#e5e7eb` (gray-300)

### 4.2 Spacing & Layout
- Grid: 8px base unit
- Padding: 16px (standard), 24px (large)
- Gap between components: 16px
- Mobile-first responsive design (320px → 481px → 1025px breakpoints)

### 4.3 Typography
- Headings: Semibold (600), 18–24px
- Body: Regular (400), 14–16px
- Monospace: 14px (JSON, code blocks)

---

## 5. Error States & Edge Cases

### 5.1 Missing Data
| Field | Fallback | Example |
|-------|----------|---------|
| `explanation` | "Explanation unavailable" | Show deterministic findings only |
| `findings[]` | "No differences found" | SummaryStrip shows "0 Findings" |
| `evidence[]` | Show left/right values | If empty, fallback to ValueComparison |
| `left_value` / `right_value` | Show raw finding JSON | If both missing, use RawJSON view |

### 5.2 Error Codes
| Code | Title | Guidance |
|------|-------|----------|
| `invalid_request` | Invalid Input | Check URL format |
| `ssrf_blocked` | Private/Local Network Blocked | Use publicly accessible URLs |
| `timeout` | Request Timeout | Check server online |
| `dns_error` | DNS Resolution Failed | Check domain names |
| `tls_error` | TLS/HTTPS Error | Check certificate configuration |
| `fetch_error` | Network Error | Check connectivity |
| `internal_error` | Server Error | Try again or contact support |

---

## 6. Testing Contract

### 6.1 Component Snapshot Tests
- SummaryStrip: Renders with sample CompareResult
- ExplanationPanel: Graceful null explanation
- ErrorBanner: Error code mapping

### 6.2 Hook Tests
- usePairHistory: Save, list, LRU eviction at 20 entries
- useComparisonPoll: Status transitions, backoff support, error typing

### 6.3 E2E Happy Path
- Enter URLs → Click Compare → See progress message → View results

---

## 7. Implementation Checklist

- [ ] ControlPlane: URL inputs, labels, swap, submit, preflight warning
- [ ] ProgressIndicator: Spinner + heuristic progress text
- [ ] ErrorBanner: Error code → guidance mapping + dismiss
- [ ] SummaryStrip: Max severity, findings count, status codes
- [ ] ExplanationPanel: Summary + ranked causes + actions
- [ ] FindingsList: Category grouping, severity sorting, expand
- [ ] FindingDetailView: Graceful degradation (evidence → values → JSON)
- [ ] RawDataView: Collapsible JSON blocks (left, right, diff)
- [ ] ResultDashboard: Compose all layers
- [ ] App.tsx: State management, polling, history, error handling

---

**DOCUMENT AUTHORITY:** This spec is binding. All components must conform to these contracts. Any deviation requires documented approval.
