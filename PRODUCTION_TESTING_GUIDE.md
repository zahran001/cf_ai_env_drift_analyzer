# Production Testing Guide — Environment Drift Analyzer

**Date:** 2026-01-19
**Status:** Ready for Production Testing
**Target:** Cloudflare Production Deployment

---

## Table of Contents

1. [Pre-Deployment Setup](#pre-deployment-setup)
2. [Endpoint Reference](#endpoint-reference)
3. [Step-by-Step Testing Workflow](#step-by-step-testing-workflow)
4. [Real-World Test Scenarios](#real-world-test-scenarios)
5. [Monitoring & Debugging](#monitoring--debugging)
6. [Error Handling Verification](#error-handling-verification)
7. [Performance Metrics](#performance-metrics)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Setup

### 1. Deploy to Production

```bash
# Ensure you're on the correct Cloudflare account
wrangler whoami

# Deploy the worker, workflow, and DO bindings
wrangler deploy

# Output will show:
# ✓ Uploaded cf_ai_env_drift_analyzer Worker script
# ✓ Uploaded 1 Durable Object migration
# ✓ Uploaded 1 Workflow script
# → Your Worker is available at: https://<WORKER_NAME>.<SUBDOMAIN>.workers.dev
```

### 2. Verify Deployment

Check Cloudflare Dashboard:
- **Workers:** `cf_ai_env_drift_analyzer` deployed ✅
- **Durable Objects:** `EnvPairDO` class exists ✅
- **Workflows:** `COMPARE_WORKFLOW` available ✅
- **Workers AI:** Llama 3.3 model accessible ✅

### 3. Gather Your Production URL

From the deployment output:
```
Your production URL: https://cf-ai-analyzer-abc123.workers.dev
```

Keep this handy for all curl commands below.

---

## Endpoint Reference

### Health Check

**Endpoint:** `GET /api/health`
**Purpose:** Verify Worker is alive
**Response (200):**
```json
{ "ok": true }
```

### Start Comparison

**Endpoint:** `POST /api/compare`
**Purpose:** Initiate environment comparison workflow
**Request Body:**
```json
{
  "leftUrl": "https://example.com",
  "rightUrl": "https://example.com/v2"
}
```

**Response (202 Accepted):**
```json
{
  "comparisonId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6-550e8400-e29b-41d4-a716-446655440000"
}
```

**Possible Error Responses:**
- `400` — Missing URLs, invalid format, private IP, localhost
- `500` — Server error during validation or workflow creation

### Poll Comparison Status

**Endpoint:** `GET /api/compare/:comparisonId`
**Purpose:** Check comparison status and retrieve results

**Response (200) - Running:**
```json
{
  "status": "running"
}
```

**Response (200) - Completed:**
```json
{
  "status": "completed",
  "result": {
    "diff": {
      "routing": { ... },
      "security": { ... },
      "cache": { ... },
      "timing": { ... },
      "findings": [ ... ]
    },
    "explanation": {
      "summary": "...",
      "ranked_causes": [ ... ],
      "actions": [ ... ]
    },
    "timestamp": 1705689600000
  }
}
```

**Response (200) - Failed:**
```json
{
  "status": "failed",
  "error": "Left probe failed: DNS error"
}
```

**Response (404) - Not Found:**
```json
{
  "error": "Comparison not found",
  "comparisonId": "..."
}
```

---

## Step-by-Step Testing Workflow

### Phase 1: Basic Connectivity

#### Test 1.1: Health Check

```bash
# Verify Worker is online
curl -X GET https://cf-ai-analyzer-abc123.workers.dev/api/health

# Expected output (immediate):
# { "ok": true }
```

**What's being tested:**
- ✅ Worker is deployed and responding
- ✅ Basic request routing works
- ✅ Network connectivity from your machine to Cloudflare

---

### Phase 2: Request Validation

These tests verify the Worker correctly validates input before starting the Workflow.

#### Test 2.1: Valid URLs (Same URLs)

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://www.cloudflare.com",
    "rightUrl": "https://www.cloudflare.com"
  }'

# Expected: HTTP 202 Accepted
# Response:
# {
#   "comparisonId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6-550e8400-e29b-41d4-a716-446655440000"
# }
```

**What's being tested:**
- ✅ Valid HTTPS URLs accepted
- ✅ Workflow creation succeeds
- ✅ Stable `comparisonId` returned (use for polling)

**Expected Workflow Behavior (in production):**
- Workflow starts asynchronously
- Probes both URLs
- Computes diff (should show "same" for identical URLs)
- Calls LLM with diff results
- Saves results to DO

---

#### Test 2.2: Different URLs

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com",
    "rightUrl": "https://example.com/v2"
  }'

# Expected: HTTP 202 Accepted
# Response: { "comparisonId": "..." }
```

**What's being tested:**
- ✅ Different URLs both accepted
- ✅ Workflow will detect routing differences

---

#### Test 2.3: Missing URL Parameter

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://example.com"
  }'

# Expected: HTTP 400 Bad Request
# Response:
# {
#   "error": "Missing leftUrl or rightUrl"
# }
```

**What's being tested:**
- ✅ Validation catches missing fields
- ✅ Error message is clear

---

#### Test 2.4: Invalid URL Format

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "not-a-url",
    "rightUrl": "https://example.com"
  }'

# Expected: HTTP 400 Bad Request
# Response:
# {
#   "error": "Invalid leftUrl: Invalid URL format"
# }
```

**What's being tested:**
- ✅ URL validation rejects malformed URLs

---

#### Test 2.5: Localhost Rejection (SSRF Protection)

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://localhost:8080",
    "rightUrl": "https://example.com"
  }'

# Expected: HTTP 400 Bad Request
# Response:
# {
#   "error": "Invalid leftUrl: Localhost access is not allowed"
# }
```

**What's being tested:**
- ✅ SSRF protection prevents localhost access
- ✅ Security guardrails are enforced

---

#### Test 2.6: Private IP Rejection (SSRF Protection)

```bash
curl -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "http://192.168.1.1",
    "rightUrl": "https://example.com"
  }'

# Expected: HTTP 400 Bad Request
# Response:
# {
#   "error": "Invalid leftUrl: Private IP addresses are not allowed"
# }
```

**What's being tested:**
- ✅ SSRF protection prevents private IPs (10.x, 172.16.x, 192.168.x)

---

### Phase 3: Workflow Execution & Polling

#### Test 3.1: Start Comparison & Poll (Basic Flow)

```bash
# STEP 1: Start comparison
RESPONSE=$(curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://www.cloudflare.com",
    "rightUrl": "https://www.cloudflare.com"
  }')

echo "Response: $RESPONSE"

# Extract comparisonId
COMPARISON_ID=$(echo $RESPONSE | jq -r '.comparisonId')
echo "comparisonId: $COMPARISON_ID"

# STEP 2: Poll status (repeat until completed)
echo "Polling comparison status..."

for i in {1..60}; do
  STATUS=$(curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID")
  STATE=$(echo $STATUS | jq -r '.status')

  echo "[$(date +'%H:%M:%S')] Attempt $i: status = $STATE"

  if [ "$STATE" = "completed" ]; then
    echo "✅ Comparison completed!"
    echo $STATUS | jq '.'
    break
  fi

  if [ "$STATE" = "failed" ]; then
    echo "❌ Comparison failed!"
    echo $STATUS | jq '.'
    break
  fi

  # Wait 1 second before retrying
  sleep 1
done
```

**What's being tested:**
- ✅ Workflow starts and runs asynchronously
- ✅ Comparison record created in DO
- ✅ Polling returns consistent comparisonId
- ✅ Status transitions: `running` → `completed` or `failed`

**Expected Timeline (Production):**
- `POST /api/compare` → Instant (HTTP 202)
- `GET /api/compare/:id` (poll 1) → `running` (1-3 sec)
- `GET /api/compare/:id` (poll 2-5) → `running` (continuing)
- `GET /api/compare/:id` (poll N) → `completed` (after 10-30 sec total)

---

#### Test 3.2: Poll Non-Existent Comparison

```bash
# Use a fake comparisonId
curl -X GET https://cf-ai-analyzer-abc123.workers.dev/api/compare/fake-id-that-does-not-exist

# Expected: HTTP 404
# Response:
# {
#   "error": "Comparison not found",
#   "comparisonId": "fake-id-that-does-not-exist"
# }
```

**What's being tested:**
- ✅ 404 handling for missing comparisons
- ✅ Expired comparisons (after DO retention window)

---

### Phase 4: Result Validation

#### Test 4.1: Inspect Completed Result

After Test 3.1 completes, inspect the full result:

```bash
curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID" | jq '.'
```

**Expected structure:**

```json
{
  "status": "completed",
  "result": {
    "diff": {
      "routing": {
        "redirect_chain_diffs": [],
        "final_url_diff": null
      },
      "security": {
        "cors_header_diffs": [],
        "auth_indicators": []
      },
      "cache": {
        "cache_control_diff": null,
        "vary_diff": null
      },
      "timing": {
        "duration_delta_ms": 0,
        "classification": "same"
      },
      "findings": [],
      "maxSeverity": "info"
    },
    "explanation": {
      "summary": "No significant differences detected between the two endpoints.",
      "ranked_causes": [],
      "actions": [],
      "notes": ["Both endpoints returned identical responses"]
    },
    "timestamp": 1705689600000
  }
}
```

**What's being tested:**
- ✅ Diff structure conforms to schema (routing, security, cache, timing)
- ✅ Findings array populated or empty
- ✅ LLM explanation generated and validated
- ✅ JSON output is valid and parseable
- ✅ Result persisted to DO

---

#### Test 4.2: Different Responses Trigger Findings

```bash
# Compare a URL with and without query parameters
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://www.cloudflare.com/",
    "rightUrl": "https://www.cloudflare.com/en-us/"
  }' | jq -r '.comparisonId' > comp_id.txt

COMPARISON_ID=$(cat comp_id.txt)

# Poll until completed
sleep 5
curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID" | jq '.result.diff.findings'
```

**What's being tested:**
- ✅ Routing differences detected
- ✅ Status code differences identified
- ✅ Header differences captured
- ✅ LLM generates explanations for findings

---

### Phase 5: Concurrent Comparisons

#### Test 5.1: Multiple Comparisons in Parallel

```bash
# Start 3 comparisons simultaneously
for i in 1 2 3; do
  curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
    -H "Content-Type: application/json" \
    -d "{
      \"leftUrl\": \"https://www.cloudflare.com\",
      \"rightUrl\": \"https://www.cloudflare.com/pricing\"
    }" > comp_$i.json &
done

wait

# Extract all comparisonIds
for i in 1 2 3; do
  COMP_ID=$(jq -r '.comparisonId' comp_$i.json)
  echo "Comparison $i: $COMP_ID"
done

# Poll all simultaneously
for i in 1 2 3; do
  COMP_ID=$(jq -r '.comparisonId' comp_$i.json)
  (
    while true; do
      STATUS=$(curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMP_ID" | jq -r '.status')
      if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
        echo "Comparison $i complete: $STATUS"
        break
      fi
      echo "Comparison $i: $STATUS"
      sleep 2
    done
  ) &
done

wait
```

**What's being tested:**
- ✅ Multiple workflows execute independently
- ✅ DO correctly manages separate comparisons
- ✅ No cross-contamination of results
- ✅ Each gets unique comparisonId (different UUIDs)

---

## Real-World Test Scenarios

### Scenario A: Detect Routing Changes

**Use Case:** Website moved from old domain to new domain

```bash
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://old-site.example.com",
    "rightUrl": "https://new-site.example.com"
  }'
```

**Expected findings:**
- Routing differences (final URL change)
- Status code differences
- Security header differences (CORS, CSP)

---

### Scenario B: Detect Cache Configuration Changes

**Use Case:** Updating cache headers on deployment

```bash
# Compare two CDN edge regions
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://api.example.com/v1/endpoint",
    "rightUrl": "https://api.example.com/v2/endpoint"
  }'
```

**Expected findings:**
- Cache-Control header changes
- Vary header differences (content negotiation)

---

### Scenario C: Detect Security Misconfigurations

**Use Case:** Website missing security headers after refactor

```bash
# Compare old vs new deployment
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://secure-api.example.com/stable",
    "rightUrl": "https://secure-api.example.com/new"
  }'
```

**Expected findings (if misconfigured):**
- Missing security headers (X-Content-Type-Options, Strict-Transport-Security)
- CORS headers removed
- Authentication indicators changed

---

### Scenario D: Detect Performance Regressions

**Use Case:** Identify if new deployment is slower

```bash
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://staging.example.com/api/endpoint",
    "rightUrl": "https://production.example.com/api/endpoint"
  }'
```

**Result includes:**
- `timing.duration_delta_ms` — latency difference
- `timing.classification` — "faster", "slower", or "same"
- LLM explanation for performance delta

---

## Monitoring & Debugging

### Real-Time Logs

**View Worker logs:**
```bash
# Tail Worker logs (requires Cloudflare CLI credentials)
wrangler tail

# Watch for:
# [Worker] POST /api/compare received
# [Worker] Workflow created successfully
# [Workflow::run] 🚀 WORKFLOW STARTED
# [Workflow::step] Probing left URL...
```

### Workflow Execution Monitoring

In Cloudflare Dashboard:
1. Navigate to **Workers** → **cf_ai_env_drift_analyzer**
2. Click **Workflows** tab
3. Find your comparison by `comparisonId`
4. View step-by-step execution timeline

### Durable Object Storage

**Inspect stored comparisons:**
```bash
# View DO tail
wrangler do tail ENVPAIR_DO

# Check DO storage usage
wrangler deploy --dry-run
```

### Troubleshooting: Workflow Not Executing

**Symptom:** POST `/api/compare` returns 202, but polling always shows 404

**Root causes:**
1. **Workflow not binding correctly** — Check wrangler.toml
2. **DO not initialized** — First comparison may take 3-5 seconds
3. **Cloudflare quota reached** — Check Workers AI rate limits

**Fix:**
```bash
# Redeploy with fresh bindings
wrangler deploy --force

# Check Cloudflare status
# https://www.cloudflarestatus.com/
```

---

## Error Handling Verification

### Test 6.1: Probe Timeout

**Scenario:** URL takes too long to respond

```bash
# Use a URL known to timeout
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/delay/15",
    "rightUrl": "https://httpbin.org/delay/1"
  }' | jq -r '.comparisonId' > timeout_comp.txt

COMPARISON_ID=$(cat timeout_comp.txt)

# Wait for workflow (should mark as failed after ~10s timeout)
sleep 15
curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID" | jq '.'
```

**Expected:**
```json
{
  "status": "failed",
  "error": "Left probe failed: Request timeout after 10000ms"
}
```

---

### Test 6.2: DNS Resolution Failure

```bash
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://this-domain-definitely-does-not-exist-12345.com",
    "rightUrl": "https://example.com"
  }' | jq -r '.comparisonId' > dns_comp.txt

COMPARISON_ID=$(cat dns_comp.txt)

# Wait for resolution
sleep 5
curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID" | jq '.'
```

**Expected:**
```json
{
  "status": "failed",
  "error": "Left probe failed: DNS resolution failed"
}
```

---

### Test 6.3: Redirect Loop Detection

```bash
# httpbin.org can simulate redirects
curl -s -X POST https://cf-ai-analyzer-abc123.workers.dev/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/redirect-to?url=https://httpbin.org/redirect-to?url=https://httpbin.org/redirect-to?url=https://httpbin.org/status/200",
    "rightUrl": "https://example.com"
  }' | jq -r '.comparisonId' > redir_comp.txt

COMPARISON_ID=$(cat redir_comp.txt)

sleep 5
curl -s -X GET "https://cf-ai-analyzer-abc123.workers.dev/api/compare/$COMPARISON_ID" | jq '.'
```

**Expected (if too many redirects):**
```json
{
  "status": "failed",
  "error": "Left probe failed: Redirect loop detected (10+ redirects)"
}
```

---

## Performance Metrics

### Baseline Metrics

Track these for each comparison:

| Metric | Expected | Unit |
|--------|----------|------|
| POST /api/compare response time | < 500ms | ms |
| Workflow start to first probe | 1-3s | seconds |
| Single probe execution | 2-8s | seconds |
| Diff computation | < 100ms | ms |
| LLM call (with retry) | 3-10s | seconds |
| Total end-to-end | 10-30s | seconds |

### Collect Metrics

```bash
#!/bin/bash

URL="https://cf-ai-analyzer-abc123.workers.dev"
ITERATIONS=5

for i in $(seq 1 $ITERATIONS); do
  echo "=== Iteration $i ==="

  # Measure POST time
  START_POST=$(date +%s%N)
  RESPONSE=$(curl -s -w '\n%{time_total}' -X POST "$URL/api/compare" \
    -H "Content-Type: application/json" \
    -d '{
      "leftUrl": "https://www.cloudflare.com",
      "rightUrl": "https://www.cloudflare.com/pricing"
    }')

  POST_TIME=$(echo "$RESPONSE" | tail -1)
  COMP_ID=$(echo "$RESPONSE" | head -1 | jq -r '.comparisonId')

  echo "POST time: ${POST_TIME}s"
  echo "Comparison ID: $COMP_ID"

  # Poll and measure total time
  START_POLL=$(date +%s%N)

  for poll in $(seq 1 60); do
    STATUS=$(curl -s -X GET "$URL/api/compare/$COMP_ID" | jq -r '.status')

    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
      END_POLL=$(date +%s%N)
      TOTAL_TIME=$(echo "scale=2; ($END_POLL - $START_POLL) / 1000000000" | bc)
      echo "Total time to completion: ${TOTAL_TIME}s (polls: $poll)"
      break
    fi

    sleep 1
  done

  echo ""
done
```

---

## Troubleshooting

### Issue: POST /api/compare returns 500

**Logs show:** `Failed to start comparison: COMPARE_WORKFLOW is not a function`

**Solution:** Workflow binding missing in wrangler.toml

```toml
[[workflows]]
name = "COMPARE_WORKFLOW"
binding = "COMPARE_WORKFLOW"
class_name = "CompareEnvironments"
```

Then redeploy:
```bash
wrangler deploy
```

---

### Issue: Comparison stuck at "running" for > 60 seconds

**Possible causes:**
1. Workflow service degradation
2. Workers AI rate limit hit
3. DO quota exceeded

**Solution:**
```bash
# Check Cloudflare status
# https://www.cloudflarestatus.com/

# Check Workers AI quota (dashboard)
# Workers → cf_ai_env_drift_analyzer → Settings → AI Bindings

# Check DO storage
wrangler do list

# If stuck, redeploy
wrangler deploy --force
```

---

### Issue: LLM Output Validation Failed

**Logs show:** `Invalid model output: confidence must be number in [0, 1]`

**Root cause:** Workers AI (Llama 3.3) returned malformed JSON

**Solution:**
1. Check PROMPTS.md matches current prompt logic
2. Retry (built-in retry loop will attempt 3 times)
3. Check Workers AI quota

---

### Issue: Comparison fails with "Probe failed: ENOTFOUND"

**Cause:** DNS resolution failed for one of the URLs

**Check:**
```bash
# Verify URL is accessible from public internet
curl -I "https://example.com"

# Check if URL is internal/firewalled
# (private IPs and localhost are already blocked by validation)
```

---

## Post-Testing Checklist

- [ ] Health check responds
- [ ] Valid URLs accepted (HTTP 202)
- [ ] Invalid URLs rejected (HTTP 400)
- [ ] Localhost blocked (HTTP 400)
- [ ] Private IPs blocked (HTTP 400)
- [ ] Comparison completes end-to-end
- [ ] Results follow schema (diff + explanation)
- [ ] LLM output is valid JSON
- [ ] Multiple comparisons run in parallel
- [ ] Polling returns consistent results
- [ ] Non-existent IDs return 404
- [ ] Error handling works (timeouts, DNS failures)
- [ ] Logs are visible in wrangler tail
- [ ] Performance within expected range (< 30s total)

---

## Production Readiness Sign-Off

Once all tests pass, you're ready for production:

- ✅ All endpoints working
- ✅ Error handling verified
- ✅ Performance acceptable
- ✅ Security validated (SSRF, input validation)
- ✅ Monitoring and logs in place
- ✅ Cloudflare bindings verified

**Status:** 🚀 Ready for Production
