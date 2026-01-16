# Phase B4 Implementation Checklist

Use this checklist to track implementation progress and acceptance testing.

---

## Pre-Implementation Setup

### Prerequisites
- [ ] Node.js 18+ installed
- [ ] `wrangler` CLI installed (`npm install -g @cloudflare/wrangler`)
- [ ] Cloudflare account created
- [ ] Project already has phases B0-B3 implemented

### Documentation Review
- [ ] Read PHASE_B4_SUMMARY.md (orientation)
- [ ] Read PHASE_B4_DESIGN.md (specification)
- [ ] Read PHASE_B4_ARCHITECTURE.md (visual flow)
- [ ] Bookmark PHASE_B4_IMPLEMENTATION.md (reference during coding)

---

## Step 1: Create SQLite Migration

- [ ] Create `migrations/` directory (if not exists)
- [ ] Create file `migrations/20250115_create_schema.sql`
- [ ] Copy SQL from PHASE_B4_IMPLEMENTATION.md Step 1
- [ ] Verify file contains:
  - [ ] `CREATE TABLE comparisons` with all 7 columns
  - [ ] `CREATE TABLE probes` with all 6 columns
  - [ ] Constraints: `CHECK status`, `CHECK side`, `UNIQUE(comparison_id, side)`, `FOREIGN KEY`
  - [ ] Indexes on `ts`, `status`, `comparison_id`, `side`
- [ ] Test syntax: `wrangler migrations apply --local`
- [ ] Verify output: "✅ Applied 1 migration"

---

## Step 2: Update wrangler.toml

- [ ] Open `wrangler.toml`
- [ ] Add D1 database section:
  ```toml
  [[d1_databases]]
  binding = "ENVPAIR_DB"
  database_name = "envpair_comparisons"
  database_id = "YOUR_ID_HERE"  # Will fill in after creating DB
  ```
- [ ] Add Durable Objects section:
  ```toml
  [durable_objects]
  bindings = [
    { name = "ENVPAIR_DO", class_name = "EnvPairDO" }
  ]
  ```
- [ ] Add migrations section:
  ```toml
  [[migrations]]
  tag = "v1"
  new_classes = ["EnvPairDO"]
  ```
- [ ] Save and verify TOML syntax (no parsing errors)

### Create D1 Database (if not exists)

- [ ] Run: `wrangler d1 create envpair_comparisons`
- [ ] Copy the `database_id` from output
- [ ] Paste into wrangler.toml `database_id` field
- [ ] Verify: `wrangler d1 list` shows database

---

## Step 3: Create Type Definitions

- [ ] Create `src/env.d.ts`
- [ ] Copy interface definitions from PHASE_B4_IMPLEMENTATION.md Step 3
- [ ] Verify exports:
  - [ ] `interface Env`
  - [ ] `interface DurableObjectState`
  - [ ] `interface D1Database`
  - [ ] `interface D1PreparedStatement`
  - [ ] `interface D1Result`

---

## Step 4: Implement EnvPairDO Class

- [ ] Create `src/storage/envPairDO.ts`
- [ ] Copy class from PHASE_B4_IMPLEMENTATION.md Step 4
- [ ] Verify implementation includes:
  - [ ] Constructor: `this.pairKey = state.id.name`
  - [ ] Constructor: `this.db = env.ENVPAIR_DB`
  - [ ] `createComparison(leftUrl, rightUrl)` method
  - [ ] `saveProbe(comparisonId, side, envelope)` method (with INSERT OR REPLACE)
  - [ ] `saveResult(comparisonId, resultJson)` method
  - [ ] `failComparison(comparisonId, error)` method
  - [ ] `getComparison(comparisonId)` method
  - [ ] `getComparisonsForHistory(limit)` method
  - [ ] `private retainLatestN(n)` method
  - [ ] `export default EnvPairDO`
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`

### Code Quality Checks
- [ ] No `any` types (use proper typing from env.d.ts)
- [ ] All methods have JSDoc comments
- [ ] Probe ID uses deterministic format: `${comparisonId}:${side}`
- [ ] saveProbe uses INSERT OR REPLACE (not INSERT)
- [ ] Ring buffer default is 50

---

## Step 5: Update Worker Entry Point

- [ ] Open `src/worker.ts`
- [ ] Update to match PHASE_B4_IMPLEMENTATION.md Step 5:
  ```typescript
  import { router } from "./api/routes";
  import type { Env } from "./env";

  export default {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response> {
      return router(request, env);
    },
  };
  ```
- [ ] Save and verify

---

## Step 6: Update API Routes

- [ ] Open `src/api/routes.ts`
- [ ] Update function signature: `async function router(request: Request, env: Env)`
- [ ] Add `handlePostCompare` function:
  - [ ] Validate input (leftUrl, rightUrl not empty)
  - [ ] Compute pairKey: `computePairKey(leftUrl, rightUrl)`
  - [ ] Get DO stub: `env.ENVPAIR_DO.idFromName(pairKey)`
  - [ ] Create comparison: `stub.createComparison(leftUrl, rightUrl)`
  - [ ] Return `{ comparisonId }` with status 201
- [ ] Add `handleGetCompareStatus` function:
  - [ ] Extract pairKey: `comparisonId.split(':')[0]`
  - [ ] Get DO stub: `env.ENVPAIR_DO.idFromName(pairKey)`
  - [ ] Get comparison: `stub.getComparison(comparisonId)`
  - [ ] Return state JSON
- [ ] Wire routes:
  - [ ] POST /api/compare → handlePostCompare
  - [ ] GET /api/compare/:id → handleGetCompareStatus
- [ ] Keep existing routes (/api/health, /api/probe)

---

## Step 7: Implement Pair Key Utility

- [ ] Create `src/utils/pairKey.ts`
- [ ] Implement `computePairKey(leftUrl, rightUrl)` function:
  - [ ] Sort URLs: `[leftUrl, rightUrl].sort()`
  - [ ] Combine: `sorted.join('|')`
  - [ ] Hash: use simple hash or crypto.subtle.digest
  - [ ] Return stable string (same URLs → same hash)
- [ ] Verify deterministic:
  - [ ] `computePairKey(A, B) === computePairKey(B, A)` ✅
  - [ ] `computePairKey(A, B)` consistent across calls ✅

---

## Step 8: Local Testing

### Compilation
- [ ] Run: `npm install` (install any missing deps)
- [ ] Run: `npx tsc --noEmit` (TypeScript check)
- [ ] Verify: No errors

### Database Setup
- [ ] Run: `wrangler migrations apply --local`
- [ ] Verify: "✅ Applied 1 migration"
- [ ] Check: `wrangler d1 execute envpair_comparisons --local "SELECT COUNT(*) FROM comparisons;"`
- [ ] Verify: Returns `[{"COUNT(*)": 0}]` (empty table)

### Start Development Server
- [ ] Run: `wrangler dev`
- [ ] Verify: Server starts on http://localhost:8787

### Test Health Endpoint
- [ ] Curl: `curl http://localhost:8787/api/health`
- [ ] Expected: `{"ok":true}`

### Test Create Comparison
- [ ] Curl:
  ```bash
  curl -X POST http://localhost:8787/api/compare \
    -H "Content-Type: application/json" \
    -d '{"leftUrl":"https://example.com","rightUrl":"https://example.org"}'
  ```
- [ ] Expected: `{"comparisonId":"<pairKey>:<uuid>"}`
- [ ] Verify: comparisonId has format `xxx:yyy` (contains colon)

### Test Get Comparison Status
- [ ] Copy the comparisonId from previous step
- [ ] Curl: `curl http://localhost:8787/api/compare/<comparisonId>`
- [ ] Expected: `{"status":"running"}`

### Verify Database State
- [ ] Run: `wrangler d1 execute envpair_comparisons --local`
- [ ] Query: `SELECT id, status FROM comparisons;`
- [ ] Expected: One row with status="running"
- [ ] Exit: `.exit`

---

## Step 9: Unit Tests (Optional but Recommended)

- [ ] Create `src/storage/__tests__/envPairDO.test.ts`
- [ ] Write test: "createComparison returns stable ID"
  - [ ] Call createComparison twice with same inputs
  - [ ] Verify both return comparisonId with same pairKey prefix
- [ ] Write test: "saveProbe is idempotent"
  - [ ] Create comparison
  - [ ] Call saveProbe with same inputs twice
  - [ ] Verify only one probe row exists
- [ ] Write test: "Ring buffer retention"
  - [ ] Create 60 comparisons
  - [ ] Verify only 50 remain (oldest deleted)
- [ ] Run: `npm test` or `vitest`
- [ ] Verify: All tests pass ✅

---

## Step 10: Idempotency Verification

### Simulate Workflow Retry

- [ ] Start dev server: `wrangler dev`

- [ ] Create comparison:
  ```bash
  curl -X POST http://localhost:8787/api/compare \
    -H "Content-Type: application/json" \
    -d '{"leftUrl":"https://example.com","rightUrl":"https://example.org"}'
  # Save comparisonId
  ```

- [ ] Open wrangler d1 console:
  ```bash
  wrangler d1 execute envpair_comparisons --local
  ```

- [ ] Manually insert a probe (simulating step 4):
  ```sql
  INSERT INTO probes (id, comparison_id, ts, side, url, envelope_json)
  VALUES ('<comparisonId>:left', '<comparisonId>', 1234567890, 'left', 'https://example.com', '{}');
  ```

- [ ] Verify one row exists:
  ```sql
  SELECT COUNT(*) FROM probes WHERE comparison_id = '<comparisonId>';
  -- Expected: 1
  ```

- [ ] Try inserting same probe again (simulating retry):
  ```sql
  INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
  VALUES ('<comparisonId>:left', '<comparisonId>', 1234567890, 'left', 'https://example.com', '{}');
  ```

- [ ] Verify still one row:
  ```sql
  SELECT COUNT(*) FROM probes WHERE comparison_id = '<comparisonId>';
  -- Expected: 1 (not 2!)
  ```

- [ ] Exit: `.exit`

---

## Step 11: Ring Buffer Verification

- [ ] Open wrangler d1 console
- [ ] Create 60 comparisons (you can use a SQL loop or script):
  ```sql
  -- Example: Insert 60 rows
  INSERT INTO comparisons (id, ts, left_url, right_url, status)
  SELECT
    'pairHash:' || printf('%d', row_number() OVER ()) AS id,
    ? + row_number() OVER () AS ts,
    'https://example.com' AS left_url,
    'https://example.org' AS right_url,
    'running' AS status
  FROM (SELECT 1 UNION SELECT 2 UNION ... SELECT 60);
  ```
  Or insert manually 60 times.

- [ ] Count rows:
  ```sql
  SELECT COUNT(*) FROM comparisons;
  -- Expected: 50 (oldest 10 deleted by ring buffer)
  ```

- [ ] Verify oldest rows deleted:
  ```sql
  SELECT id, ts FROM comparisons ORDER BY ts ASC LIMIT 10;
  -- Expected: rows 11-20 (rows 1-10 deleted)
  ```

---

## Step 12: Acceptance Testing

### Acceptance Criteria Checklist

- [ ] **SQLite schema created**
  - [ ] Verify with: `SELECT name FROM sqlite_master WHERE type='table';`
  - [ ] Expected: `comparisons`, `probes`

- [ ] **EnvPairDO instantiates**
  - [ ] No errors in console when calling DO methods
  - [ ] Class is properly exported as default

- [ ] **createComparison returns stable ID**
  - [ ] Format: `${pairKey}:${uuid}`
  - [ ] Same URLs always hash to same pairKey
  - [ ] UUID is different each time (randomUUID())

- [ ] **saveProbe is idempotent**
  - [ ] Retry with same inputs → UPDATE, not INSERT
  - [ ] UNIQUE constraint enforced
  - [ ] Only one probe per (comparison_id, side)

- [ ] **Ring buffer works**
  - [ ] After 51st insert, oldest deleted
  - [ ] Keeps last 50 comparisons
  - [ ] Cleanup is synchronous

- [ ] **Status transitions correct**
  - [ ] createComparison → status='running'
  - [ ] saveResult → status='completed'
  - [ ] failComparison → status='failed'
  - [ ] All transitions update DO correctly

- [ ] **getComparison returns state**
  - [ ] Returns `{ status, result?, error? }`
  - [ ] Correctly populated from DB
  - [ ] Handles missing comparisons gracefully

- [ ] **getComparisonsForHistory works**
  - [ ] Returns array of completed comparisons
  - [ ] Ordered by ts DESC
  - [ ] Limited to requested count

- [ ] **Workflow can call DO methods**
  - [ ] Prepare for Phase B6: DO methods will be called via step.do()
  - [ ] All methods are async
  - [ ] All methods are retry-safe

- [ ] **Deterministic routing**
  - [ ] Same URLs always compute same pairKey
  - [ ] Same pairKey always routes to same DO
  - [ ] Different URL pairs use different DO instances

---

## Cleanup & Documentation

- [ ] Kill dev server (Ctrl+C)
- [ ] Review code for:
  - [ ] No console.log() (use proper logging)
  - [ ] No TODO comments (or mark for Phase B5+)
  - [ ] No hardcoded values (use constants)
  - [ ] No secrets in code or git history

- [ ] Update project documentation:
  - [ ] Add note to README.md about Phase B4 completion
  - [ ] Record database_id in wrangler.toml if new DB
  - [ ] Update IMPLEMENTATION_STATUS.md (if it exists)

- [ ] Commit to git:
  ```bash
  git add -A
  git commit -m "Phase B4: Implement Durable Objects + SQLite ring buffer"
  ```

---

## Common Issues & Troubleshooting

### "Cannot find module './env'"
- [ ] Verify `src/env.d.ts` exists
- [ ] Run: `npx tsc --noEmit` to check for other errors

### "ENVPAIR_DB is not defined"
- [ ] Check wrangler.toml has D1 binding
- [ ] Check binding name is exactly "ENVPAIR_DB"
- [ ] Verify database exists: `wrangler d1 list`

### "EnvPairDO is not a valid class"
- [ ] Verify class exported as default: `export default EnvPairDO`
- [ ] Check wrangler.toml class_name matches: `class_name = "EnvPairDO"`
- [ ] Verify migrations section has tag="v1" and new_classes=["EnvPairDO"]

### "Migration failed"
- [ ] Check SQL syntax in migration file
- [ ] Try: `wrangler d1 execute envpair_comparisons --local < migrations/20250115_create_schema.sql`
- [ ] Look at error message carefully (might be table already exists)

### "Probes being duplicated on retry"
- [ ] Verify `saveProbe` uses `INSERT OR REPLACE` (not INSERT)
- [ ] Check probe ID is deterministic: `${comparisonId}:${side}`
- [ ] Verify UNIQUE constraint on probes table

---

## After Completion

### Phase B4 is Done When:
✅ All acceptance criteria pass
✅ Local testing works end-to-end
✅ Idempotency verified
✅ Ring buffer verified
✅ Code committed to git

### Next Phase: B5
- [ ] Integrate Workers AI for LLM explanations
- [ ] Build `explainDiff(diff, history)` function
- [ ] Add LLM calls to Workflow

### Phase B5 Dependencies:
- ✅ Phase B4 done (this phase)
- ✅ Phase B3 done (ActiveProbeProvider)
- ✅ Phase B2 done (Deterministic Diff)

---

## Reference Documents

- **PHASE_B4_DESIGN.md** — Specification (bookmark for details)
- **PHASE_B4_IMPLEMENTATION.md** — Step-by-step guide (reference while coding)
- **PHASE_B4_ARCHITECTURE.md** — Visual diagrams (understand data flow)
- **PHASE_B4_SUMMARY.md** — Quick orientation (read first)
- **PHASE_B4_CLAUDE_MAPPING.md** — Compliance check (verify against rulebook)

---

## Estimated Effort

- **Setup & reading:** 30-45 min
- **Coding:** 1-2 hours
- **Testing & verification:** 30-45 min
- **Total:** 2-3 hours

---

## Sign-Off

When you've completed all checkboxes:

- [ ] All items checked ✅
- [ ] Tests pass ✅
- [ ] Code committed to git ✅
- [ ] Ready to move to Phase B5 ✅

**Phase B4 is complete! 🚀**

Next up: Phase B5 (LLM Integration)
