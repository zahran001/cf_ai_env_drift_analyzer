# UI Wireframes & Ideation – MVP
**cf_ai_env_drift_analyzer**

Visual mockups and interaction flows for Phase 3 implementation.

---

## 1. App Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ App Container (max-width: 1200px, centered, light bg)  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Header                                          │   │
│  │ Title: "cf_ai_env_drift_analyzer"              │   │
│  │ Subtitle: "Compare environments, understand drift" │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Control Plane (Input)                           │   │
│  │ ┌─────────────────────────────────────────────┐ │   │
│  │ │ Left URL        [_______________] [⟲ Swap] │ │   │
│  │ │ Left Label      [_______________]          │ │   │
│  │ │                                             │ │   │
│  │ │ Right URL       [_______________]          │ │   │
│  │ │ Right Label     [_______________]          │ │   │
│  │ │                                             │ │   │
│  │ │                        [Compare] (or disabled) │   │
│  │ │                                             │ │   │
│  │ │ ⚠️ Preflight: "Localhost not allowed"      │ │   │
│  │ └─────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Status / Progress (visible during poll)        │   │
│  │ ◌ Probing environments… (45% through poll)    │   │
│  │ Tip: Backend processing your comparison        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Error Banner (if error)                         │   │
│  │ 🔴 SSRF Blocked                                │   │
│  │ Both URLs must be publicly accessible.          │   │
│  │ Localhost and private IPs are not allowed.      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Results Dashboard (if result ready)             │   │
│  │ [Layer 0: Summary Strip]                        │   │
│  │ [Layer 1: Explanation Panel]                    │   │
│  │ [Layer 2: Findings List]                        │   │
│  │ [Layer 3: Raw Data View]                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Control Plane – Input Header

### Wireframe

```
┌──────────────────────────────────────────────────┐
│ Comparison Setup                                 │
│                                                  │
│ Left Environment          Right Environment     │
│                                                  │
│ [https://staging.ex...] ⟲ [https://prod.ex...]│
│  Enter left URL          Swap   Enter right URL │
│                                                  │
│ [Staging]         [Optional label]   [Production]
│                                                  │
│                    [Compare]                    │
│                                                  │
│ ⚠️ Localhost not allowed. Both URLs must be    │
│    publicly accessible.                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Behavior

**Swap Button:**
- Swaps `leftUrl ↔ rightUrl` and `leftLabel ↔ rightLabel`
- Semantics stay the same (left vs right analysis)

**SSRF Preflight Warnings:**
```
Warn if user enters:
- localhost, 127.0.0.1, ::1 (loopback)
- 10.x.x.x, 172.16-31.x.x, 192.168.x.x (private)
- 169.254.x.x (link-local)

Display: ⚠️ "This looks like a private/local address. Only public URLs are allowed."
Action: Block submit button until fixed
```

**Compare Button:**
- Disabled if: leftUrl empty OR rightUrl empty OR poll.status === "running"
- Label changes: "Compare" → "Comparing..." during poll
- Cursor: pointer (enabled) → not-allowed (disabled)

---

## 3. Progress Indicator

### Heuristic Progress Timeline

```
Time (seconds)  |  Displayed Message
────────────────┼─────────────────────────────────
0 – 2           |  ◌ Initializing comparison…
2 – 5           |  ◌ Probing environments…
5 – 8           |  ◌ Analyzing drift & generating explanation…
> 10            |  ⏱️ Taking longer than usual… (tap to cancel)
────────────────┴─────────────────────────────────

Completion    |  ✓ Comparison complete!
              |  (transition to dashboard)
```

### Visual

```
┌──────────────────────────────────────────┐
│ ◌ Probing environments…                 │
│ ___________●_______________ 45% (~3s)  │
│ Backend processing your comparison        │
└──────────────────────────────────────────┘
```

---

## 4. Summary Strip (Layer 0)

### Wireframe

```
┌─────────────────────────────────────────────────────────┐
│                    COMPARISON SUMMARY                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 🔴 Critical Severity  │  3 Findings  │  5 ms slower   │
│                                                         │
│ Left:  https://staging.example.com/api                │
│        ✓ 200 OK (42ms)                                │
│                                                         │
│ Right: https://prod.example.com/api                   │
│        ✗ 404 Not Found (47ms)                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Components

**SeverityBadge:**
```
🔴 Critical  |  🟠 Warning  |  🔵 Info
```

**StatusCodeBadge:**
```
✓ 200 OK (42ms)  |  ✗ 404 Not Found (47ms)
```

**FindingsCount:**
```
3 Findings: 1 Critical | 2 Warning
```

---

## 5. Explanation Panel (Layer 1)

### Wireframe

```
┌─────────────────────────────────────────────────────────┐
│                     AI EXPLANATION                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Summary                                                 │
│ ────────────────────────────────────────────────────── │
│ The right endpoint is not found (404) compared to      │
│ the left (200). This suggests the route or resource   │
│ does not exist in production, or routing has changed. │
│                                                         │
│ Ranked Causes (by confidence)                          │
│ ────────────────────────────────────────────────────── │
│                                                         │
│ 1. Route not deployed to production (92% confidence)   │
│    ████████████████████░ Evidence: 404 vs 200 status  │
│                                                         │
│ 2. Endpoint path changed (78% confidence)              │
│    ████████████████░░░░ Evidence: FINAL_URL_MISMATCH  │
│                                                         │
│ 3. Rate limiting or blocking rule (45% confidence)     │
│    ██████████░░░░░░░░░░ Evidence: Timing normal       │
│                                                         │
│ Recommended Actions                                     │
│ ────────────────────────────────────────────────────── │
│ → Verify endpoint is deployed to production            │
│ → Check routing configuration and edge rules           │
│ → Review logs for 404 errors in production             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Sub-components

**ConfidenceBar:**
```
████████████████████░  92%
```

**CauseItem:**
- Cause text
- Confidence bar + percentage
- Evidence (clickable to expand/highlight)

**ActionItem:**
- Arrow icon + action text
- Optional: "Why?" toggle for detailed reasoning

---

## 6. Findings List (Layer 2)

### Wireframe

```
┌─────────────────────────────────────────────────────────┐
│                       FINDINGS                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 🔴 ROUTING (1 finding)                                │
│ ├─ [▼] STATUS_MISMATCH                                │
│ │   Left: 200 OK | Right: 404 Not Found              │
│ │   [View evidence]                                   │
│ └─                                                    │
│                                                         │
│ 🟠 SECURITY (1 finding)                               │
│ ├─ [▶] CORS_HEADER_DRIFT                              │
│ │   Left: Access-Control-Allow-Origin: *             │
│ │   Right: [Not present]                             │
│ └─                                                    │
│                                                         │
│ 🔵 CACHE (1 finding)                                  │
│ ├─ [▶] CACHE_HEADER_DRIFT                             │
│ │   Left: public, max-age=3600                       │
│ │   Right: no-store                                   │
│ └─                                                    │
│                                                         │
│ Filter by: [All] [Critical] [Warning] [Info]          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Behavior

**Expandable Rows:**
- Click row to expand → shows detail view
- Click [▼] or [▶] to toggle
- Only one expanded at a time (or allow multiple)

**Category Grouping:**
- Routing, Security, Cache, Timing, Platform, Unknown
- Show count per category: `(1)`, `(2)`, etc.
- Collapsible sections

**Sorting:**
- Primary: Severity (Critical → Warning → Info)
- Secondary: Code (alphabetical)

---

## 7. Finding Detail View (Layer 3)

### Wireframe (Modal)

```
┌─────────────────────────────────────────────────────────┐
│ 🔴 STATUS_MISMATCH                               [✕]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Finding: HTTP status codes differ                      │
│ Category: Routing | Severity: Critical                 │
│                                                         │
│ Left Value               Right Value                    │
│ ────────────────────────────────────────────────────── │
│ 200 OK (Success)         404 Not Found (Client Error)  │
│                                                         │
│ Evidence                                                │
│ ────────────────────────────────────────────────────── │
│ • Left probe returned HTTP 200                         │
│ • Right probe returned HTTP 404                        │
│ • Both reached final URL without redirect loops        │
│                                                         │
│ Recommendations                                         │
│ ────────────────────────────────────────────────────── │
│ ✓ Ensure the endpoint is deployed to production       │
│ ✓ Check routing configuration and edge rules          │
│ ✓ Review deployment changelog for recent changes      │
│                                                         │
│                                  [Close]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Alternative: Inline Expansion

```
┌────────────────────────────────────────────┐
│ [▼] STATUS_MISMATCH                        │
│     HTTP status codes differ                │
│                                             │
│     Left: 200 OK                            │
│     Right: 404 Not Found                    │
│                                             │
│     Evidence:                               │
│     • Left probe returned HTTP 200          │
│     • Right probe returned HTTP 404         │
│                                             │
│     Recommendations:                        │
│     ✓ Ensure endpoint is deployed          │
│     ✓ Check routing configuration          │
│                                             │
└────────────────────────────────────────────┘
```

---

## 8. Raw Data View (Layer 3 – Forensics)

### Wireframe

```
┌─────────────────────────────────────────────────────────┐
│                   RAW DATA (FORENSICS)                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [▼] Left Probe (SignalEnvelope)                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ {                                                  │ │
│ │   "schemaVersion": 1,                              │ │
│ │   "comparisonId": "abc123...",                     │ │
│ │   "probeId": "abc123...:left",                     │ │
│ │   "side": "left",                                  │ │
│ │   "requestedUrl": "https://staging.example.com",   │ │
│ │   "result": {                                      │ │
│ │     "ok": true,                                    │ │
│ │     "response": {                                  │ │
│ │       "status": 200,                               │ │
│ │       "finalUrl": "https://staging.example.com",   │ │
│ │       "headers": { ... }                           │ │
│ │     },                                             │ │
│ │     "durationMs": 42                               │ │
│ │   }                                                │ │
│ │ }                                                  │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
│ [▼] Right Probe (SignalEnvelope)                       │
│ ┌────────────────────────────────────────────────────┐ │
│ │ { ... }                                            │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
│ [▼] Diff (EnvDiff)                                     │
│ ┌────────────────────────────────────────────────────┐ │
│ │ {                                                  │ │
│ │   "schemaVersion": 1,                              │ │
│ │   "findings": [ ... ],                             │ │
│ │   "maxSeverity": "critical",                       │ │
│ │   "status": { "changed": true, ... }               │ │
│ │ }                                                  │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Error Scenarios

### Error: SSRF Blocked

```
┌─────────────────────────────────────────────────────────┐
│ 🔴 Private/Local Network Blocked                        │
│ Both URLs must be publicly accessible.                  │
│ Localhost, private IPs (10.x.x.x, 192.168.x.x, etc.),  │
│ and link-local addresses (169.254.x.x) are not allowed.│
│                                                         │
│ [Dismiss]                                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Error: Timeout

```
┌─────────────────────────────────────────────────────────┐
│ ⏱️ Request Timeout                                      │
│ One or both URLs took too long to respond (>10s).      │
│ Check that the servers are online and responsive.      │
│                                                         │
│ [Try Again]                                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Error: DNS Error

```
┌─────────────────────────────────────────────────────────┐
│ 🌐 DNS Resolution Failed                                │
│ One or both hostnames could not be resolved.            │
│ Check that the domain names are spelled correctly.      │
│                                                         │
│ [Try Again]                                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Mobile Responsive Layout

### Mobile (≤768px)

```
┌───────────────────────────┐
│ cf_ai_env_drift_analyzer │
├───────────────────────────┤
│                           │
│ Left URL                  │
│ [_____________________]   │
│ Left Label (optional)     │
│ [_____________________]   │
│                           │
│ Right URL                 │
│ [_____________________]   │
│ Right Label (optional)    │
│ [_____________________]   │
│                           │
│ [Compare]  [⟲]           │
│                           │
├───────────────────────────┤
│ Results (stacked vertical)│
│ [Summary]                 │
│ [Explanation]             │
│ [Findings]                │
│ [Raw Data]                │
│                           │
└───────────────────────────┘
```

### Tablet (768px – 1024px)

```
┌─────────────────────────────────┐
│ cf_ai_env_drift_analyzer       │
├─────────────────────────────────┤
│ Left URL      | Right URL       │
│ [___________] | [_____________] │
│ Left Label    | Right Label     │
│ [___________] | [_____________] │
│                                 │
│         [Compare] [⟲]           │
│                                 │
├─────────────────────────────────┤
│ Results (50/50 grid)            │
│ ┌──────────────┬─────────────┐  │
│ │ Summary      │ Explanation │  │
│ │ [...]        │ [...]       │  │
│ ├──────────────┴─────────────┤  │
│ │ Findings                   │  │
│ │ [...]                      │  │
│ ├────────────────────────────┤  │
│ │ Raw Data                   │  │
│ │ [...]                      │  │
│ └────────────────────────────┘  │
└─────────────────────────────────┘
```

### Desktop (>1024px)

```
Full layout as shown in Section 1 (max-width: 1200px)
```

---

## 11. Color Palette & Typography

### Colors

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| 🔴 Critical | Red 600 | `#dc2626` | Severity badge, alerts |
| 🟠 Warning | Amber 500 | `#f59e0b` | Warnings, cautions |
| 🔵 Info | Blue 500 | `#3b82f6` | Info badges, links |
| Background | Gray 50 | `#f9fafb` | Page background |
| Card | White | `#ffffff` | Card containers |
| Border | Gray 200 | `#e5e7eb` | Dividers, borders |
| Text Primary | Gray 900 | `#111827` | Body text |
| Text Secondary | Gray 600 | `#4b5563` | Labels, hints |
| Success | Green 600 | `#16a34a` | Checkmarks, success |

### Typography

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Page Title | 28px | Bold (700) | 1.2 |
| Heading 2 | 20px | Semibold (600) | 1.3 |
| Heading 3 | 16px | Semibold (600) | 1.3 |
| Body | 14px | Regular (400) | 1.5 |
| Label | 13px | Medium (500) | 1.4 |
| Monospace | 13px | Regular (400) | 1.6 |

---

## 12. Interaction Flows

### Flow 1: Happy Path (Comparison Found)

```
User
  ↓ Enters URLs (left & right)
  ↓ Clicks "Compare"
  ↓
Backend
  ↓ Validates inputs (SSRF check)
  ↓ Starts workflow
  ↓
Frontend
  ↓ Shows heuristic progress: "Initializing…"
  ↓ (2s later) "Probing environments…"
  ↓ (5s later) "Analyzing drift…"
  ↓
Backend (Workflow)
  ↓ Probes both URLs
  ↓ Computes diff
  ↓ Calls LLM
  ↓ Saves result
  ↓
Frontend
  ↓ Poll returns { status: "completed", result: {...} }
  ↓ Renders dashboard
  ↓ Saves to localStorage history
  ↓
User
  ↓ Reads summary, findings, explanation
  ↓ Clicks finding to expand detail
  ↓ Clicks "Raw Data" to inspect JSON
  ↓ (optional) "Re-run" or "Last Run"
```

### Flow 2: Error Path (SSRF Blocked)

```
User
  ↓ Enters localhost (e.g., http://127.0.0.1:8000)
  ↓
Frontend (Preflight)
  ↓ Detects IP is loopback/private
  ↓ Shows ⚠️ warning below input
  ↓ Disables submit button
  ↓
User
  ↓ Reads warning
  ↓ Corrects URL or cancels
  ↓ (if corrects) Clicks "Compare"
  ↓
Backend
  ↓ (backup validation) Rejects with 400 + error code "ssrf_blocked"
  ↓
Frontend
  ↓ Shows ErrorBanner with human-readable guidance
  ↓ "Both URLs must be publicly accessible…"
```

### Flow 3: Recovery Path (Retry)

```
User
  ↓ Clicks "Compare"
  ↓
Backend
  ↓ Network timeout (>10s)
  ↓
Frontend
  ↓ Shows ⏱️ "Taking longer than usual…" (after 10s)
  ↓
Backend (Workflow Timeout)
  ↓ Fails with "timeout" error
  ↓
Frontend
  ↓ Poll returns { status: "failed", error: { code: "timeout", ... } }
  ↓ ErrorBanner shows "Request Timeout"
  ↓ Shows "[Try Again]" button
  ↓
User
  ↓ Clicks "[Try Again]"
  ↓ (re-run same URLs)
```

---

## 13. Accessibility Considerations

### Keyboard Navigation

```
Tab order:
1. Left URL input
2. Left Label input
3. Right URL input
4. Right Label input
5. Swap button
6. Compare button
7. Finding items (expandable)
8. Raw Data toggle buttons
9. Dismiss error button
```

### Screen Reader Compatibility

- All buttons have `aria-label` (descriptive text)
- Severity badges have `aria-label="Critical"` (not just emoji)
- Finding list: `<section aria-label="Findings">`
- Modal: `<dialog role="dialog" aria-labelledby="finding-title">`

### Color Contrast

- Text on background: ≥7:1 ratio (WCAG AAA)
- Icons + badges: ≥4.5:1 ratio (WCAG AA)
- Test with WAVE or axe DevTools

---

## 14. Micro-interactions & Animations

### Loading Spinner

```
Simple rotating circle or dots:
◌ ◌ ◌  →  ◌ ◌ ◌  →  ◌ ◌ ◌  →  ◌ ◌ ◌
        ◌             ◌             ◌
(1s loop, low motion respect via prefers-reduced-motion)
```

### Expand/Collapse Finding

```
Arrow rotation: [▶] → [▼] (90° rotation on click)
Content: Fade in (opacity 0→1 over 200ms)
Smooth transition on element height
```

### Error Banner Dismiss

```
Fade out on click: opacity 1→0 over 150ms
Slide up if needed for mobile
```

### Hover States

```
Buttons:     background-color shift, cursor: pointer
Links:       text-decoration: underline
Rows:        background-color: gray-100 (subtle highlight)
Badges:      opacity increase (0.8→1.0)
```

---

## 15. Responsive Breakpoints

```
Mobile:       max-width: 640px
Tablet:       641px – 1024px
Desktop:      1025px+

Adjustments:
- Mobile: Single column, stack inputs vertically
- Tablet: Two-column grids where applicable
- Desktop: Maximize horizontal space, max-width: 1200px
```

---

## 16. Copy & Messaging Examples

### Success States

- "✓ Comparison complete!" (in title bar)
- "3 findings discovered" (in SummaryStrip)
- "No differences found" (if maxSeverity is "info")

### Progress States

- "Initializing comparison…" (0–2s)
- "Probing environments…" (2–5s)
- "Analyzing drift & generating explanation…" (5–8s)
- "Taking longer than usual. Please wait…" (>10s)

### Error States

- "Private/Local Network Blocked" (SSRF)
- "Request Timeout – servers not responding" (timeout)
- "DNS Resolution Failed – check domain names" (DNS)

### Call-to-Actions

- "Compare" (primary button)
- "Try Again" (retry after error)
- "Dismiss" (close error banner)
- "View Evidence" (expand finding)
- "Re-run" (repeat comparison)

---

## 17. Example Color Usage

### SummaryStrip with Multiple Findings

```
┌──────────────────────────────────────────┐
│                                          │
│ 🔴 Critical (1)  🟠 Warning (2)  🔵 Info (0)  │
│                                          │
│ Status: 200 → 404  Duration: 42ms → 67ms│
│                                          │
└──────────────────────────────────────────┘
```

### Findings List Grouped & Colored

```
🔴 ROUTING (1)
├─ STATUS_MISMATCH (critical)
│  ████████████████████░░ 200 vs 404
│

🟠 SECURITY (1)
├─ CORS_HEADER_DRIFT (warn)
│  ████████████████░░░░░░ * vs example.com

🔵 CACHE (1)
├─ CACHE_HEADER_DRIFT (warn)
│  ████████████████░░░░░░ public vs no-store
```

---

## 18. Feedback & Validation Messages

### Input Validation (Real-time, non-blocking)

```
Left URL: [https://...]
           ⚠️ Localhost not allowed (soft warning, disabled submit)

Right URL: [http://127.0.0.1/]
            🔴 This is a private IP address (harder warning)
```

### Polling Feedback

```
Status: Running
━━━━━●━━━━━━━━━━━━━━ 43% complete (estimated)
"Probing environments…"
[Cancel] button available
```

### Success Feedback

```
✓ Comparison complete!
[Summary visible immediately]
[Auto-scroll to top of results]
```

---

## 19. Design System Constants (CSS Variables)

```css
/* Spacing */
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;

/* Colors */
--color-critical: #dc2626;
--color-warn: #f59e0b;
--color-info: #3b82f6;
--color-bg: #f9fafb;
--color-card: #ffffff;
--color-text-primary: #111827;
--color-text-secondary: #4b5563;

/* Typography */
--font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-family-mono: 'Monaco', 'Courier New', monospace;
--font-size-sm: 13px;
--font-size-base: 14px;
--font-size-lg: 16px;
--font-size-xl: 20px;
--font-size-2xl: 28px;

/* Shadows */
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);

/* Border Radius */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;

/* Transitions */
--transition-fast: 150ms ease-in-out;
--transition-normal: 200ms ease-in-out;
--transition-slow: 300ms ease-in-out;
```

---

## Conclusion

These wireframes and design specifications provide a complete visual reference for implementing the MVP UI. They ensure:

✅ **Consistency** across all pages and states
✅ **Accessibility** for screen readers and keyboard navigation
✅ **Responsiveness** across mobile, tablet, desktop
✅ **Clarity** for users understanding results
✅ **Guidance** for developers building components

**Ready to implement?** Start with the wireframes in Section 1–2 (Input layer), then move to dashboard components (Sections 4–8).

---

**Document Version:** 1.0
**Last Updated:** 2026-01-28
**Status:** Ready for Implementation
