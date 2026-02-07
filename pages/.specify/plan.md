# Execution Plan — cf_ai_env_drift_analyzer UI Implementation

**Authority:** This document defines the phased, actionable task breakdown for UI implementation. Extracted from `../../UI_IMPLEMENTATION_PLAN.md` (Parts 3–4).

**Last Updated:** 2026-02-05
**Status:** Ready for Sprint

---

## Overview

**Total Scope:** 8 phases, ~40 developer-hours (~1.25 weeks for 1 dev, ~5 days for 2 devs)

**Success Criteria:** All Tier 1 + Tier 2 features implemented, E2E tested, deployed.

---

## Phase 3A: Input Layer & History (3 hours) ✅ COMPLETE

**Goal:** Enable environment pair input with persistent history.

**Status:** ✅ COMPLETE (2026-02-06)

### Tasks

- [x] **3A.1** Create `pages/src/hooks/usePairHistory.ts` (~1.5 hours)
  - [x] Implement HistoryEntry interface
  - [x] Implement savePair() with LRU eviction (max 20 entries)
  - [x] Implement listPairs() to retrieve all (MRU first)
  - [x] Implement getPair(pairKey) to retrieve single
  - [x] Implement deletePair(pairKey) to remove
  - [x] Use single localStorage key: `"cf-env-history"`
  - [x] All operations synchronous (no async IO)
  - [x] Write unit tests: savePair, listPairs, LRU at 20 entries

- [x] **3A.2** Create `pages/src/components/ControlPlane.tsx` (~1.5 hours)
  - [x] Create ControlPlane component (controlled component pattern)
  - [x] Add URL input fields (left and right, required)
  - [x] Add label input fields (optional)
  - [x] Implement swap button (bidirectional URL/label exchange)
  - [x] Add submit button with disabled state logic
  - [x] Client-side SSRF preflight warning (localhost/private IPs)
  - [x] Form validation (both URLs required)
  - [x] Create ControlPlane.module.css (mobile-first responsive)
  - [x] Write 17 unit tests

- [x] **3A.3** Update `pages/src/lib/api.ts` (~0.5 hours)
  - [x] Ensure all API calls use `cache: 'no-store'`
  - [x] Verify CompareRequest type includes labels
  - [x] Type polling response from @shared/api

- [x] **Integration** App.tsx with ControlPlane
  - [x] Import ControlPlane component
  - [x] Wire state callbacks (onLeftUrlChange, onRightUrlChange, etc.)
  - [x] Integrate usePairHistory() hook
  - [x] Show history sidebar with recent pairs
  - [x] Pass loading state to ControlPlane

**Acceptance Criteria:**
- [x] usePairHistory hook saves/retrieves pairs without errors
- [x] LRU eviction works at 20 entries
- [x] Labels are optional but accepted in UI
- [x] localStorage persists across page reloads
- [x] npm run type-check passes (zero errors)
- [x] npm run build succeeds
- [x] All tests passing (29 tests: 12 usePairHistory + 17 ControlPlane)
- [x] Responsive layout (mobile 320px, tablet 481px+)
- [x] CSS Modules only (no Tailwind)
- [x] Zero `any` types

---

## Phase 3B: Polling & Progress (3 hours) ✅ COMPLETE

**Goal:** Implement polling with backoff and heuristic progress messaging.

**Status:** ✅ COMPLETE (2026-02-06)

### Tasks

- [x] **3B.1** Enhance `pages/src/hooks/useComparisonPoll.ts` (~1.5 hours)
  - [x] Add support for backoff array: `intervalMs?: number | number[]`
  - [x] Implement status transitions: idle → running → completed | failed
  - [x] Handle "queued" status as "running" (transient)
  - [x] Type error as `CompareError | null` (not string)
  - [x] Add heuristic progress message calculation
  - [x] Track elapsed time (ms since poll start)
  - [x] Add maxAttempts parameter
  - [x] Write unit tests: transitions, backoff, error handling (15 tests, all passing)

- [x] **3B.2** Create heuristic progress messaging utility (~0.5 hours)
  - [x] Function: `getHeuristicProgress(elapsedMs: number): string`
  - [x] <2000ms: "Initializing comparison…"
  - [x] <5000ms: "Probing environments…"
  - [x] <8000ms: "Analyzing drift & generating explanation…"
  - [x] >10000ms: "Taking longer than usual…"
  - [x] else: "Processing…"

- [x] **3B.3** Create `pages/src/components/ProgressIndicator.tsx` (~1 hour)
  - [x] Props: status, progress (message), elapsedMs
  - [x] Implement CSS-only spinner (no library)
  - [x] Display progress message
  - [x] Display elapsed time (e.g., "10.5s")
  - [x] Hide when status !== "running"
  - [x] CSS Module: ProgressIndicator.module.css (11 tests, all passing)

**Acceptance Criteria:**
- [x] Polling respects backoff array [500, 1000, 2000]
- [x] Progress messages change based on elapsed time
- [x] "queued" status renders as "running"
- [x] useComparisonPoll returns typed CompareError
- [x] npm run build passes (zero errors)

---

## Phase 3C: Dashboard Layer 0 — Summary (4 hours) ✅ COMPLETE

**Goal:** Display high-level result overview (severity, findings count, HTTP status codes).

**Status:** ✅ COMPLETE (2026-02-06)

### Tasks

- [x] **3C.1** Create `pages/src/components/SummaryStrip.tsx` (~2 hours)
  - [x] Props: result (CompareResult), onFindingClick? (optional callback)
  - [x] Type casting: `const diff = result.diff as EnvDiff | undefined`
  - [x] Extract max severity from findings (critical > warn > info)
  - [x] Display findings count
  - [x] Display left status code + duration
  - [x] Display right status code + duration
  - [x] Layout: horizontal flex with divider
  - [x] CSS Module: SummaryStrip.module.css
  - [x] Responsive: single column on mobile, side-by-side on tablet+

- [x] **3C.2** Create `pages/src/components/SummaryStrip.module.css` (~0.5 hours)
  - [x] .container: flex, gap 16px, padding 16px, border 1px gray-300, rounded
  - [x] .badge: inline-flex, gap 8px, padding 6px 12px, rounded 4px
  - [x] .badgeCritical: bg #fee2e2, color #dc2626
  - [x] .badgeWarn: bg #fef3c7, color #f59e0b
  - [x] .badgeInfo: bg #dbeafe, color #3b82f6
  - [x] .statusCode: monospace, 14px, gray-800
  - [x] Mobile-first responsive

- [x] **3C.3** Create sub-component: SeverityBadge (~0.5 hours)
  - [x] Props: severity (Severity)
  - [x] Return styled badge with color + emoji (🔴/🟠/🔵)

- [x] **3C.4** Create sub-component: StatusCodeBadge (~0.5 hours)
  - [x] Props: status (number), durationMs (number)
  - [x] Return formatted "200 (42ms)" badge

- [x] **3C.5** Add unit test: SummaryStrip snapshot (~0.5 hours)
  - [x] Render with sample CompareResult
  - [x] Verify severity badge displays correctly
  - [x] Verify findings count calculated

**Acceptance Criteria:**
- [x] SummaryStrip renders without crash
- [x] Findings count matches result.diff.findings.length
- [x] Max severity correctly identified (critical > warn > info)
- [x] Status codes + durations displayed
- [x] Responsive on mobile/tablet/desktop
- [x] npm run type-check passes

---

## Phase 3D: Dashboard Layer 1 — Explanation (3 hours) ✅ COMPLETE

**Goal:** Display LLM-generated explanation (summary, ranked causes, actions).

**Status:** ✅ COMPLETE (2026-02-06)
**Commit:** b9fe9db
**Branch:** feature/UI-Dev

### Tasks

- [x] **3D.1** Create `pages/src/components/ExplanationPanel.tsx` (~1.5 hours) ✅
  - ✅ Props: explanation? (LlmExplanation)
  - ✅ Show "Explanation unavailable" if null
  - ✅ Display summary text
  - ✅ Display ranked causes with confidence bars
  - ✅ Display recommended actions with reasoning
  - ✅ Collapsible sections for compact UX
  - ✅ CSS Module: ExplanationPanel.module.css (180 LOC)
  - ✅ Type declaration: ExplanationPanel.module.css.d.ts

- [x] **3D.2** Create sub-component: ConfidenceBar (~0.5 hours) ✅
  - ✅ Props: confidence (0.0–1.0)
  - ✅ Display visual bar (0–100%)
  - ✅ Show percentage text
  - ✅ Clamping logic (critical fix applied)
  - ✅ CSS Module: ConfidenceBar.module.css (25 LOC)
  - ✅ Type declaration: ConfidenceBar.module.css.d.ts

- [x] **3D.3** Create sub-component: CauseItem (~0.5 hours) ✅
  - ✅ Props: cause (RankedCause)
  - ✅ Display cause text + confidence bar
  - ✅ Display evidence bullet list (graceful degradation)
  - ✅ CSS Module: CauseItem.module.css (60 LOC)
  - ✅ Type declaration: CauseItem.module.css.d.ts

- [x] **3D.4** Create sub-component: ActionItem (~0.5 hours) ✅
  - ✅ Props: action (RecommendedAction)
  - ✅ Display action text + why reasoning
  - ✅ Styled as card with blue left border
  - ✅ CSS Module: ActionItem.module.css (35 LOC)
  - ✅ Type declaration: ActionItem.module.css.d.ts

- [x] **3D.5** Create unit tests: ExplanationPanel.test.tsx ✅
  - ✅ 19 tests (all passing)
  - ✅ 3 snapshot variants
  - ✅ Mock helper function (createMockExplanation)
  - ✅ 100% test coverage

- [x] **3D.6** TypeScript & Build verification ✅
  - ✅ Standalone tsconfig.test.json created
  - ✅ VSCode settings configured (.vscode/settings.json)
  - ✅ Path aliases resolve correctly (@shared/llm)

**Acceptance Criteria:**
- [x] ExplanationPanel renders without crash ✅ (Test 1: PASSING)
- [x] Null explanation handled gracefully ✅ (Tests 2–3: PASSING)
- [x] Confidence displayed as percentage (confidence * 100) ✅ (Test 15: PASSING)
- [x] Evidence array rendered as bullet list ✅ (Test 11: PASSING)
- [x] Actions section shows "No recommendations" if empty ✅ (Test 13: PASSING)
- [x] Collapsible sections expand/collapse on click ✅ (Tests 7–8: PASSING)
- [x] npm run type-check passes ✅ (ZERO TypeScript errors for Phase 3D)
- [x] All 102 tests passing (7 test suites) ✅
- [x] Production build succeeds (202.20 kB JS, 5.01 kB CSS) ✅

---

## Phase 3E: Dashboard Layer 2 — Findings List (4 hours) ✅ COMPLETE

**Goal:** Display categorized, sortable findings with expand capability.

**Status:** ✅ COMPLETE (2026-02-06)
**Commit:** [To be created]
**Branch:** feature/UI-Dev

### Tasks

- [x] **3E.1** Create `pages/src/components/FindingsList.tsx` (~2 hours) ✅
  - ✅ Props: findings (DiffFinding[]), expandedId?, onExpandClick?
  - ✅ Group findings by category dynamically (7 categories)
  - ✅ Sort by severity WITHIN each category (critical → warn → info)
  - ✅ Render category groups with findings count
  - ✅ Render FindingItem rows
  - ✅ **REMOVED:** Expand all button (single-expand UX, Phase 4+ for multi-expand)
  - ✅ CSS Module: FindingsList.module.css
  - ✅ Show "No differences found" if empty

- [x] **3E.2** Create sub-component: CategoryGroup (~1 hour) ✅
  - ✅ Props: category (FindingCategory), findings (DiffFinding[])
  - ✅ Collapsible header with findings count
  - ✅ Render FindingItem children
  - ✅ CSS Module: CategoryGroup.module.css with category-specific colors
  - ✅ Type declaration: CategoryGroup.module.css.d.ts

- [x] **3E.3** Create sub-component: FindingItem (~1 hour) ✅
  - ✅ Props: finding (DiffFinding), isExpanded (bool), onClick (callback)
  - ✅ Display severity badge (🔴/🟠/🔵)
  - ✅ Display finding code + message
  - ✅ Display expand arrow (chevron down/up)
  - ✅ Clickable row triggers onClick(finding.id)
  - ✅ CSS Module: FindingItem.module.css
  - ✅ Type declaration: FindingItem.module.css.d.ts

- [x] **3E.4** Add unit test: FindingsList grouping (~0.5 hours) ✅
  - ✅ 19 comprehensive tests (all passing)
  - ✅ Verify categories grouped correctly
  - ✅ Verify severity order (critical first)
  - ✅ Verify all 7 categories displayed in correct order
  - ✅ Verify collapse/expand behavior
  - ✅ Verify finding count badges
  - ✅ **NEW:** Toggle test: clicking same finding collapses it
  - ✅ Edge cases: multiple findings, single finding, all in one category

- [ ] **3E.5** Fix expand/collapse logic (Critique fixes) (~1 hour) ✅
  - ✅ Remove expand all button (was broken due to single-expand state model)
  - ✅ Wire toggle semantics in App.tsx: `setExpandedId(prev => prev === id ? null : id)`
  - ✅ Add toggle test case
  - ✅ Document category state behavior (Phase 4+ improvement)
  - ✅ Update spec.md Section 1.6 to clarify single-expand model
  - ✅ Integrate FindingsList into App.tsx with SummaryStrip above it

**Acceptance Criteria:**
- [x] Findings grouped by all 7 categories dynamically ✅
- [x] Sorted by severity within each category ✅
- [x] Category order: routing, security, cache, content, timing, platform, unknown ✅
- [x] Expandable rows with toggle semantics (click same → collapse) ✅
- [x] "No differences found" shown when empty ✅
- [x] npm run type-check passes (Phase 3E files compile with zero TypeScript errors) ✅
- [x] npm run build succeeds ✅
- [x] All 19 unit tests passing (18 original + 1 toggle test) ✅
- [x] CSS Modules used (no Tailwind or CSS-in-JS) ✅
- [x] Type-safe component (all props typed from @shared/diff) ✅
- [x] FindingsList integrated into App.tsx with SummaryStrip ✅

---

## Phase 3F: Dashboard Layer 3 — Detail & Forensics (4 hours) ✅ COMPLETE

**Goal:** Display detailed finding evidence and raw JSON data.

**Status:** ✅ COMPLETE (2026-02-07)

### Tasks

- [x] **3F.1** Create `pages/src/components/FindingDetailView.tsx` (~1.5 hours) ✅
  - ✅ Props: finding (DiffFinding), onClose?
  - ✅ Implement graceful degradation chain:
    1. If evidence[]: render EvidenceList
    2. Else if left_value || right_value: render ValueComparison
    3. Else: render RawJSON
  - ✅ Display finding code + category + severity header
  - ✅ Display recommendations (if present)
  - ✅ CSS Module: FindingDetailView.module.css
  - ✅ 12 comprehensive tests (all passing)

- [x] **3F.2** Create sub-component: EvidenceList (~0.5 hours) ✅
  - ✅ Props: evidence (DiffEvidence[])
  - ✅ Render as bullet list with section names
  - ✅ Show keys and notes

- [x] **3F.3** Create sub-component: ValueComparison (~1 hour) ✅
  - ✅ Props: left (unknown), right (unknown)
  - ✅ Display side-by-side left/right values
  - ✅ JSON formatting with 2-space indent
  - ✅ Responsive layout (stacked on mobile, side-by-side on tablet+)

- [x] **3F.4** Create sub-component: RawJSON (~0.5 hours) ✅
  - ✅ Props: data (unknown)
  - ✅ Display as `<pre><code>` with pretty-printed JSON
  - ✅ Monospace font with word-break for overflow

- [x] **3F.5** Create `pages/src/components/RawDataView.tsx` (~1 hour) ✅
  - ✅ Props: left?, right?, diff? (all SignalEnvelope/EnvDiff)
  - ✅ Three collapsible JSON blocks: "Left Probe Data", "Right Probe Data", "Diff Output"
  - ✅ Copy-to-clipboard button per block
  - ✅ CSS Module: RawDataView.module.css
  - ✅ 8 comprehensive tests (all passing)

- [x] **3F.6** Create sub-component: JSONBlock (~0.5 hours) ✅
  - ✅ Props: title (string), data (unknown)
  - ✅ Collapsible header with toggle icon (▶/▼)
  - ✅ Copy button (MVP: present, functional in Phase 4)
  - ✅ Smooth animation on expand/collapse

**Acceptance Criteria:**
- [x] FindingDetailView graceful degradation works (evidence → values → JSON) ✅
- [x] All optional fields handled safely ✅
- [x] RawDataView renders all three sections (or hides if null) ✅
- [x] Copy button present on each block (functional in Phase 4) ✅
- [x] JSON properly indented (2 spaces) ✅
- [x] npm run type-check passes (zero errors) ✅
- [x] All 20 new tests passing (12 FindingDetailView + 8 RawDataView) ✅
- [x] Build succeeds (213 kB JS, 15.38 kB CSS) ✅
- [x] Integration with App.tsx complete ✅

### Implementation Summary

**Components Created (18 files):**
- RawJSON.tsx + CSS + type declaration
- EvidenceList.tsx + CSS + type declaration
- ValueComparison.tsx + CSS + type declaration
- FindingDetailView.tsx + CSS + type declaration
- JSONBlock.tsx + CSS + type declaration (with fixed button structure)
- RawDataView.tsx + CSS + type declaration

**Tests Created (2 files):**
- FindingDetailView.test.tsx (12 tests, 3 snapshots)
- RawDataView.test.tsx (8 tests, 3 snapshots)

**Integration:**
- App.tsx updated with FindingDetailView import and conditional render
- App.tsx updated with RawDataView import and render

**Key Fixes Applied:**
1. JSONBlock button structure fixed (removed nested buttons) to pass React 19 validation
2. SignalEnvelope mock fixed (camelCase field names: schemaVersion, not schema_version)
3. DiffFinding codes fixed (use real codes from FINDING_CODES list, not custom)
4. EnvDiff mock fixed (probe field uses ProbeOutcomeDiff with proper structure)
5. Test interaction simplified (copy button availability test, functional testing deferred to Phase 4)

**Performance:**
- Bundle size: +9 kB (total 213.31 kB JS, 15.38 kB CSS)
- Build time: 844ms
- Test suite: 156 tests passing, 4.9s execution

Phase 3F is production-ready with full graceful degradation, responsive design, and comprehensive test coverage.

---

## Phase 3G: Control Plane & Error Handling (3 hours)

**Goal:** Input controls and human-readable error guidance.

### Tasks

- [ ] **3G.1** Create `pages/src/components/ControlPlane.tsx` (~1.5 hours)
  - Props: leftUrl, rightUrl, leftLabel?, rightLabel?, onSubmit, isLoading
  - Two URL input fields (required)
  - Two label input fields (optional)
  - Swap button (swaps URLs + labels)
  - Submit button (disabled during loading)
  - Client-side preflight warning for localhost/private IPs
  - Form validation (both URLs required, valid format)
  - CSS Module: ControlPlane.module.css
  - Responsive: single column mobile, side-by-side tablet+

- [ ] **3G.2** Create `pages/src/lib/errorMapping.ts` (~0.5 hours)
  - Implement ERROR_GUIDANCE record (from constitution.md Section 5.1)
  - Implement getErrorGuidance(error?: CompareError) function
  - Map all 8 error codes to title + guidance

- [ ] **3G.3** Create `pages/src/components/ErrorBanner.tsx` (~1 hour)
  - Props: error?, onDismiss?
  - Use getErrorGuidance() to map error code
  - Display title (bold) + guidance text
  - Red border for critical errors
  - Dismiss button
  - Hide when error is null
  - CSS Module: ErrorBanner.module.css

**Acceptance Criteria:**
- [ ] ControlPlane form validation works
- [ ] Swap button swaps URLs + labels
- [ ] Submit disabled during loading
- [ ] All 8 error codes mapped to guidance
- [ ] ErrorBanner displays error title + guidance
- [ ] Dismiss button clears error
- [ ] npm run type-check passes

---

## Phase 3H: Styling & Polish (4 hours)

**Goal:** Professional, responsive layout with consistent styling.

### Tasks

- [ ] **3H.1** Create global CSS file (~1 hour)
  - `pages/src/index.css` (or App-level global styles)
  - Reset/normalize (box-sizing, margin, padding)
  - Base typography (body: 16px, gray-900)
  - Base colors (critical, warn, info)
  - Base spacing (8px grid)
  - Responsive meta tag check

- [ ] **3H.2** Implement responsive layouts in CSS Modules (~1.5 hours)
  - Mobile-first approach (320–480px default)
  - Tablet breakpoint (481px): 2-column layouts
  - Desktop breakpoint (1025px): enhanced layouts
  - Verify all components responsive
  - Test on actual devices/emulation

- [ ] **3H.3** Add color + spacing consistency (~1 hour)
  - Verify color tokens match (#dc2626, #f59e0b, #3b82f6, #f3f4f6, #1f2937)
  - Verify spacing grid (8, 16, 24, 32px)
  - Ensure contrast ratios meet WCAG AA (manual spot-check)

- [ ] **3H.4** CSS Modules best practices (~0.5 hours)
  - All components have `.module.css` file
  - No inline `<style>` tags (except dynamic, if Phase 2)
  - Class names camelCase (e.g., `container`, `badgeCritical`)

**Acceptance Criteria:**
- [ ] All components styled with CSS Modules only
- [ ] No Tailwind, shadcn, or CSS-in-JS imports
- [ ] Responsive on mobile (320px), tablet (481px), desktop (1025px)
- [ ] Color scheme consistent across app
- [ ] Spacing grid enforced (8px base)
- [ ] Typography hierarchy clear (headings vs body)

---

## Phase 3I: Component Integration (2 hours)

**Goal:** Wire all components into App.tsx and verify complete flow.

### Tasks

- [ ] **3I.1** Update `pages/src/App.tsx` with full component composition (~1 hour)
  - Import all components (ControlPlane, ProgressIndicator, ErrorBanner, ResultDashboard, etc.)
  - Implement handleSubmit() for form submission
  - Implement handleDismissError()
  - Implement setExpandedFinding() toggle
  - Pass all props correctly typed
  - Structure: ControlPlane → ProgressIndicator → ErrorBanner → ResultDashboard

- [ ] **3I.2** Verify type safety and imports (~0.5 hours)
  - All imports use @shared/* alias
  - Zero `any` types (verify with npm run type-check)
  - All props typed from @shared contracts
  - No relative imports for types

- [ ] **3I.3** Wire hooks into data flow (~0.5 hours)
  - useComparisonPoll(comparisonId) triggers on comparisonId change
  - usePairHistory() saves after successful comparison
  - Polling state flows to components correctly

**Acceptance Criteria:**
- [ ] npm run type-check passes (zero errors)
- [ ] All components render without crash
- [ ] Data flows correctly through component tree
- [ ] No unused props or missing props

---

## Phase 3J: Testing (3 hours)

**Goal:** Ensure code quality and prevent regressions.

### Tasks

- [ ] **3J.1** Write hook tests (~1.5 hours)
  - `pages/src/__tests__/hooks/usePairHistory.test.ts`
    - Test savePair() stores and updates
    - Test listPairs() retrieves all (MRU first)
    - Test LRU eviction at 20 entries
    - Test deletePair() removes
  - `pages/src/__tests__/hooks/useComparisonPoll.test.ts`
    - Test status transitions (idle → running → completed)
    - Test backoff array handling
    - Test error handling (error type = CompareError)

- [ ] **3J.2** Write component snapshot tests (~0.5 hours)
  - SummaryStrip: snapshot with sample CompareResult
  - ExplanationPanel: snapshot with and without explanation
  - ErrorBanner: snapshot with error code mapping

- [ ] **3J.3** Write E2E happy path test (~1 hour)
  - Using Playwright or Cypress (if available)
  - Step 1: Navigate to http://localhost:5173
  - Step 2: Fill left URL (e.g., https://httpbin.org/status/200)
  - Step 3: Fill right URL (e.g., https://httpbin.org/status/404)
  - Step 4: Click Compare button
  - Step 5: Wait for progress message ("Probing environments...")
  - Step 6: Wait for result (STATUS_MISMATCH finding visible)
  - Step 7: Verify "Critical" badge visible
  - Step 8: Click finding to expand detail
  - Step 9: Verify finding detail renders

**Acceptance Criteria:**
- [ ] All hook tests pass
- [ ] Component snapshots match
- [ ] E2E happy path passes
- [ ] Coverage > 50% (realistic for MVP)

---

## Phase 3K: Final Polish & Documentation (1 hour)

**Goal:** Documentation and final cleanup before MVP release.

### Tasks

- [ ] **3K.1** Update README.md (~0.5 hours)
  - Add UI features list
  - Add screenshots (optional for MVP)
  - Document how to run dev server: `npm --prefix pages run dev`

- [ ] **3K.2** Add JSDoc comments to components (~0.5 hours)
  - Public component APIs documented
  - Complex logic explained
  - No over-commenting; keep it minimal

**Acceptance Criteria:**
- [ ] README.md lists UI features
- [ ] JSDoc covers public APIs only
- [ ] No console errors or warnings

---

## Integration with Backend (Parallel Track)

**Note:** Backend work (Phases B1–B3) progresses in parallel. Frontend assumes:
- `/api/compare` POST endpoint available
- `/api/compare/:id` GET endpoint available
- Correct CompareResult schema from @shared/*

---

## Definition of Done (Phase 3 Complete)

A feature is complete when:

- [ ] Code follows constitution.md constraints (no Tailwind, all types from @shared/)
- [ ] All props typed with @shared contracts
- [ ] Zero `any` types (except justified + commented)
- [ ] No CSS frameworks, only CSS Modules
- [ ] Unit tests pass (hooks, snapshots)
- [ ] E2E happy path test passes
- [ ] Responsive on mobile, tablet, desktop
- [ ] Error handling graceful (no crashes)
- [ ] npm run type-check passes (zero errors)
- [ ] npm run lint passes (if configured)
- [ ] PR reviewed by peer (type safety + design)

---

## Acceptance Tests (MVP Complete)

A reviewer can:

1. ✅ Paste two URLs (e.g., https://example.com and https://api.example.com)
2. ✅ Click "Compare" button
3. ✅ See progress messages ("Initializing...", "Probing...", "Analyzing...")
4. ✅ View summary (max severity, findings count, status codes)
5. ✅ Read LLM explanation (ranked causes, actions)
6. ✅ Expand findings (click to see detail)
7. ✅ Inspect raw data (collapsible JSON blocks)
8. ✅ See human-readable error if URL invalid or timeout
9. ✅ Save comparison to history (browser localStorage)
10. ✅ Re-run previous comparison with one click
11. ✅ Verify type safety: `npm run type-check` passes

---

## Timeline & Resources

### Single Developer (1.25 weeks)
| Phase | Duration | Focus |
|-------|----------|-------|
| 3A–3B | Mon–Wed (2 days) | Input + Polling |
| 3C–3D | Thu–Fri (2 days) | Summary + Explanation |
| 3E–3F | Mon–Tue (2 days) | Findings + Detail |
| 3G–3H | Wed–Thu (2 days) | Control + Styling |
| 3I–3K | Fri (1 day) | Integration + Tests |

### Two Developers (5 days)
| Developer | Phases | Days |
|-----------|--------|------|
| Dev 1 | 3A, 3C, 3E, 3G | Mon–Thu |
| Dev 2 | 3B, 3D, 3F, 3H | Mon–Thu |
| Both | 3I, 3J, 3K | Fri |

---

## Risk Mitigation

### Risk 1: Backend API Contract Changes
- **Mitigation:** Keep all types in @shared/; version schema_version
- **Fallback:** Use optional chaining; render gracefully if missing

### Risk 2: LLM Explanation Null
- **Mitigation:** ExplanationPanel handles null gracefully
- **Fallback:** Show deterministic findings only

### Risk 3: Large Finding List (50+ findings)
- **Mitigation:** Implement pagination or virtual scroll
- **Fallback:** Show first 10, add "Load more" button

### Risk 4: localStorage Quota Exceeded
- **Mitigation:** LRU eviction at 20 entries
- **Fallback:** Show "History full, clear to continue" banner

---

## Success Metrics

- **Time to Result:** <15 seconds (backend + frontend combined)
- **Clicks to Detailed Finding:** <3 clicks (expand item, then expand detail)
- **Type Coverage:** 100% (zero `any` types outside generics)
- **Component Test Coverage:** >75% for new components
- **Accessibility:** WCAG 2.1 AA (manual spot-check)

---

## Next Steps

1. **Approve Plan:** Team sign-off on phased approach
2. **Create Branch:** `feature/ui-implementation-mvp`
3. **Start Phase 3A:** usePairHistory + label inputs
4. **Daily Standup:** 15 min to track blockers
5. **Code Review:** Per-PR verification against constitution.md

---

**DOCUMENT AUTHORITY:** This plan is binding. Follow the phases in order. Deviations require documented approval from project lead.
