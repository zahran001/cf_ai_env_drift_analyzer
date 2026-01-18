# Workflow Integration Testing Guide

**Purpose:** Validate the complete workflow orchestration end-to-end

---

## Prerequisites

```bash
# Ensure dependencies are installed
npm install

# Apply database migrations
npx wrangler migrations apply --local

# Verify environment is clean
rm -rf .wrangler/  # Clear any stale state
```

---

## Test 1: Workflow Startup

**Goal:** Verify POST /api/compare starts workflow and returns comparisonId

### Steps
```bash
# Terminal 1: Start wrangler dev
wrangler dev

# Terminal 2: POST request
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/status/200",
    "rightUrl": "https://httpbin.org/status/200"
  }'
```

### Expected Output
```json
{
  "comparisonId": "abc123def456:uuid-here"
}
```

### Validation
- [ ] Status code is 202 (Accepted)
- [ ] Response contains comparisonId with format `${pairKey}:${uuid}`
- [ ] Logs show `[Worker] Started workflow ...`

---

## Test 2: Workflow Execution Progress

**Goal:** Verify workflow steps execute in order with logging

### Steps
```bash
# Keep both terminals open from Test 1
# Watch the wrangler dev output for workflow logs

# You should see logs like:
# [Workflow] Starting comparison abc123def456:uuid...
# [Workflow] Comparison created, status=running
# [Workflow] Diff computed: N findings
# [Workflow] LLM explanation generated
# [Workflow] Comparison completed
```

### Expected Logs
```
[Workflow] Starting comparison {comparisonId} for {leftUrl} <-> {rightUrl}
[Workflow] Comparison {comparisonId} created, status=running
[Workflow] Diff computed for {comparisonId}: X findings
[Workflow] LLM explanation generated for {comparisonId}
[Workflow] Comparison {comparisonId} completed
```

### Validation
- [ ] All steps logged in order
- [ ] No error logs in workflow execution
- [ ] Workflow completion log appears

---

## Test 3: Polling Comparison Status

**Goal:** Verify GET /api/compare/:comparisonId returns status

### Steps
```bash
# Use comparisonId from Test 1
curl http://localhost:8787/api/compare/{comparisonId}
```

### Expected Output (while running)
```json
{
  "status": "running"
}
```

### Expected Output (after completion)
```json
{
  "status": "completed",
  "result": {
    "diff": { ... },
    "explanation": { ... },
    "timestamp": 1234567890
  }
}
```

### Validation
- [ ] First poll returns status=running
- [ ] Subsequent polls eventually return status=completed
- [ ] Result contains diff and explanation objects
- [ ] timestamp is numeric

---

## Test 4: Idempotency Verification

**Goal:** Verify workflow steps are idempotent (no duplicates on retry)

### Steps

1. Start a comparison:
```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/status/200",
    "rightUrl": "https://httpbin.org/status/201"
  }'
# Response: { "comparisonId": "def456abc789:uuid" }
```

2. Kill wrangler during workflow (CTRL+C) after 2-3 seconds

3. Verify DO storage before restart:
```bash
# In the wrangler database, check probes table:
# SELECT COUNT(*) FROM probes WHERE comparison_id = 'def456abc789:uuid'
# Should show: 0, 1, or 2 (not duplicates)
```

4. Restart wrangler:
```bash
wrangler dev
```

5. Poll status:
```bash
curl http://localhost:8787/api/compare/def456abc789:uuid
```

6. Check DO storage again:
```bash
# SELECT * FROM probes WHERE comparison_id = 'def456abc789:uuid'
# Should show exactly 2 rows (left + right), not 4
```

### Validation
- [ ] No error on workflow restart
- [ ] Probes table has exactly 2 rows (left + right), not 4
- [ ] Workflow retries from where it failed (or completes)
- [ ] Final result is same as if no interruption occurred

---

## Test 5: Error Handling

**Goal:** Verify workflow handles errors gracefully

### Test 5a: Invalid URL
```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "not-a-url",
    "rightUrl": "https://httpbin.org/status/200"
  }'
```

**Expected:** 400 error with clear message

```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://127.0.0.1/local",
    "rightUrl": "https://httpbin.org/status/200"
  }'
```

**Expected:** 400 error (SSRF blocked)

### Test 5b: Probe Failure
```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://invalid-domain-that-does-not-exist.test",
    "rightUrl": "https://httpbin.org/status/200"
  }'
# Returns: { "comparisonId": "..." }
```

Poll until complete:
```bash
curl http://localhost:8787/api/compare/{comparisonId}
```

**Expected:** status=failed with error message:
```json
{
  "status": "failed",
  "error": "Left probe failed: DNS error"
}
```

Verify DO record:
```bash
# SELECT status, error FROM comparisons WHERE id = '{comparisonId}'
# Should show: status='failed', error='Left probe failed: ...'
```

### Validation
- [ ] Invalid URL rejected with 400 before workflow starts
- [ ] SSRF blocked with 400
- [ ] Probe failure caught and marked in DO
- [ ] Error message is clear and actionable

---

## Test 6: LLM Retry Behavior

**Goal:** Verify LLM failures retry with backoff (max 3 attempts)

### Setup (Simulate LLM Failure)
To test LLM retry behavior, you'd need to:
1. Mock or intercept Workers AI calls
2. Simulate failure on attempt 1-2, success on attempt 3

**Expected Behavior:**
```
explainDiff_attempt_1: fails, backoff 2s
[Workflow] Backing off 2000ms before retry
explainDiff_attempt_2: fails, backoff 4s
[Workflow] Backing off 4000ms before retry
explainDiff_attempt_3: succeeds
[Workflow] LLM explanation generated
```

### Validation
- [ ] Step names include attempt count
- [ ] Backoff durations are correct (2^attempt * 1000ms)
- [ ] Max 3 attempts (not infinite)
- [ ] Success after retry logs success message
- [ ] Failure after 3 attempts marks as failed

---

## Test 7: Ring Buffer Retention

**Goal:** Verify old comparisons are automatically deleted (keep last 50)

### Steps

1. Create 51 comparisons (loop 51 times):
```bash
for i in {1..51}; do
  curl -X POST http://localhost:8787/api/compare \
    -H "Content-Type: application/json" \
    -d "{
      \"leftUrl\": \"https://httpbin.org/status/200\",
      \"rightUrl\": \"https://httpbin.org/status/$((200 + i))\",
    }" > /dev/null
  echo "Created comparison $i"
done
```

2. Check DO storage:
```bash
# SELECT COUNT(*) FROM comparisons
# Should show: 50 (oldest deleted)
```

3. Verify oldest is gone:
```bash
# SELECT ts FROM comparisons ORDER BY ts ASC LIMIT 1
# Should NOT be the timestamp from comparison #1
```

### Validation
- [ ] Ring buffer keeps exactly 50 comparisons
- [ ] Oldest comparisons are deleted
- [ ] Associated probes are also deleted (CASCADE)
- [ ] New comparisons are not affected

---

## Test 8: Diff & Classification

**Goal:** Verify deterministic diff computation and findings generation

### Steps

1. Start a comparison that produces findings:
```bash
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/status/200",
    "rightUrl": "https://httpbin.org/status/201"
  }'
# Returns: { "comparisonId": "..." }
```

2. Poll until completed:
```bash
curl http://localhost:8787/api/compare/{comparisonId}
# Wait for status=completed
```

3. Extract findings from result:
```json
{
  "status": "completed",
  "result": {
    "diff": {
      "findings": [
        {
          "id": "STATUS_MISMATCH:status",
          "code": "STATUS_MISMATCH",
          "category": "routing",
          "severity": "warn",
          "message": "Status differs: 200 vs 201",
          "left_value": 200,
          "right_value": 201
        }
      ],
      "maxSeverity": "warn"
    }
  }
}
```

4. Verify determinism (run twice with same inputs):
```bash
# First comparison
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.com/v2"}'

# Poll and save findings

# Second comparison (same URLs in different order)
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com/v2","rightUrl":"https://example.com"}'

# Poll and save findings
# (Note: pairKey is the same because URLs are sorted)
```

### Validation
- [ ] Findings array is populated
- [ ] Each finding has id, code, category, severity, message
- [ ] findings are sorted by severity DESC, then code, then message
- [ ] Same URL pair (in any order) produces same findings (deterministic)
- [ ] maxSeverity reflects highest severity in findings

---

## Test 9: LLM Output Format

**Goal:** Verify LLM explanation matches required schema

### Steps

1. Get a completed comparison:
```bash
curl http://localhost:8787/api/compare/{completedComparisonId}
```

2. Verify explanation structure:
```json
{
  "result": {
    "explanation": {
      "summary": "string (non-empty)",
      "ranked_causes": [
        {
          "cause": "string",
          "confidence": 0.0,  // number in [0, 1]
          "evidence": ["string array"]
        }
      ],
      "actions": [
        {
          "action": "string",
          "why": "string"
        }
      ],
      "notes": ["string array (optional)"]
    }
  }
}
```

### Validation
- [ ] summary is non-empty string
- [ ] ranked_causes is array (may be empty)
- [ ] Each cause has: string, numeric confidence in [0,1], array evidence
- [ ] actions is array (may be empty)
- [ ] Each action has: string action, string why
- [ ] notes is optional array
- [ ] No additional fields

---

## Troubleshooting

### Workflow not starting
- Check: `npm run build` (compilation errors?)
- Check: wrangler.toml has `[[workflows]]` section
- Check: Worker logs for `[Worker] Started workflow` message

### Workflow hangs (never completes)
- Kill wrangler (CTRL+C)
- Check DO storage: is comparison marked `running`?
- Check logs for probe errors (network timeouts?)
- Restart wrangler and check if it retries

### Probes show duplicate rows
- Ring buffer did not run
- Check: DO.createComparison() calls retainLatestN()
- Check: UNIQUE(comparison_id, side) constraint exists

### LLM fails with "invalid output"
- Check: Workers AI is returning valid JSON
- Check: JSON structure matches ExplainedComparison schema
- Check: confidence values are numeric in [0, 1]

### Polling returns 404
- comparisonId format is wrong (missing colon?)
- DO was deleted by ring buffer (created >50 comparisons ago)
- pairKey extraction failed

---

## Performance Benchmarks

Expected timings:

| Step | Duration | Notes |
|------|----------|-------|
| POST /api/compare | <100ms | Validation + pairKey + UUID gen |
| Probe (single URL) | 1-10s | Network + redirects |
| Save probe to DO | <100ms | Local SQLite write |
| Compute diff | <50ms | Pure function |
| Load history | <100ms | DO read |
| Call LLM | 2-5s | Workers AI latency |
| Save result | <100ms | DO write |
| **Total** | **5-25s** | Depends on network latency |

---

## Continuous Testing

For automated testing, create a test suite:

```bash
# test/e2e.test.ts
describe("Workflow Integration", () => {
  it("should complete a full comparison", async () => {
    const response = await fetch("http://localhost:8787/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leftUrl: "https://httpbin.org/status/200",
        rightUrl: "https://httpbin.org/status/201"
      })
    });

    const { comparisonId } = await response.json();
    expect(response.status).toBe(202);
    expect(comparisonId).toMatch(/^[a-f0-9]+:[a-f0-9-]+$/);

    // Poll until completed
    let status = "running";
    let result;
    while (status === "running") {
      const poll = await fetch(`http://localhost:8787/api/compare/${comparisonId}`);
      const data = await poll.json();
      status = data.status;
      result = data;
      await new Promise(r => setTimeout(r, 500));
    }

    expect(status).toBe("completed");
    expect(result.result.diff.findings).toBeDefined();
    expect(result.result.explanation.summary).toBeDefined();
  });
});
```

---

## Completion Checklist

- [ ] Test 1: Workflow startup (POST returns 202)
- [ ] Test 2: Execution logs visible
- [ ] Test 3: Polling returns status
- [ ] Test 4: Idempotency (no duplicates on retry)
- [ ] Test 5: Error handling (invalid URL, probe failure)
- [ ] Test 6: LLM retry behavior (if testable)
- [ ] Test 7: Ring buffer retention (50 comparisons)
- [ ] Test 8: Diff determinism
- [ ] Test 9: LLM output schema
- [ ] Performance: All steps complete in <30s

---

**After completing these tests, the workflow integration is production-ready.**
