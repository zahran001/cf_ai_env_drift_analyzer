# Test Quick Start Guide

## Run All Tests

```bash
npm test
```

## Run Specific Test File

```bash
# SSRF Validation (most critical)
npm test -- validate.test.ts

# Probe Provider
npm test -- activeProbe.unit.test.ts

# API Routes
npm test -- routes.test.ts

# DO Storage
npm test -- envPairDO.test.ts
```

## Run with Coverage Report

```bash
npm test -- --coverage
```

## Watch Mode (Re-run on file changes)

```bash
npm test -- --watch
```

## Run with UI Dashboard

```bash
npm test -- --ui
```

---

## Quick Manual Testing

### 1. Test SSRF Protection (All should be REJECTED)

```bash
# Start backend
wrangler dev &

# Test: localhost
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://localhost","rightUrl":"https://example.com"}' | jq

# Test: 127.0.0.1
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://127.0.0.1","rightUrl":"https://example.com"}' | jq

# Test: 127.1 (short form)
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://127.1","rightUrl":"https://example.com"}' | jq

# Test: Private IP
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://192.168.1.1","rightUrl":"https://example.com"}' | jq

# Test: IPv6-mapped
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://[::ffff:127.0.0.1]","rightUrl":"https://example.com"}' | jq

# Test: Numeric bypass
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"http://2130706433","rightUrl":"https://example.com"}' | jq
```

### 2. Test Valid Requests (Should ACCEPT)

```bash
# Test: Valid public URLs
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.org"}' | jq
# Expected: 202 Accepted with comparisonId
```

### 3. Test /api/probe is Gone

```bash
# Should return 404
curl http://localhost:8787/api/probe?url=https://example.com
# Expected: 404 Not Found
```

### 4. Test Health Check

```bash
curl http://localhost:8787/api/health | jq
# Expected: { "ok": true }
```

---

## Expected Test Results

### All Tests Pass
```
✓ src/api/__tests__/validate.test.ts (100+ cases)
✓ src/providers/__tests__/activeProbe.unit.test.ts (40+ cases)
✓ src/api/__tests__/routes.test.ts (30+ cases)
✓ src/storage/__tests__/envPairDO.test.ts (design specs)

Test Files: 4 passed (4)
Tests: 200+ passed (200+)
```

### Coverage Expected
- validate.ts: 100%
- routes.ts: 95%+
- activeProbe.ts: 90%+ (integration tests would be needed for 100%)
- envPairDO.ts: Design specs (requires SQLite integration)

---

## Troubleshooting

### Tests not found
```bash
# Make sure vitest is installed
npm install --save-dev vitest

# Check test files exist
ls src/api/__tests__/
ls src/providers/__tests__/
```

### Import errors
```bash
# Ensure all paths are correct:
# - src/api/validate.ts
# - src/api/routes.ts
# - src/providers/activeProbe.ts
# - src/storage/envPairDO.ts
```

### Module resolution
```bash
# Check vitest.config.ts exists (if needed)
# Or update vite.config.ts with test configuration
```

---

## Test Files Location

```
src/
├── api/
│   ├── __tests__/
│   │   ├── validate.test.ts       ← SSRF tests
│   │   └── routes.test.ts         ← API endpoint tests
│   ├── routes.ts
│   └── validate.ts
├── providers/
│   ├── __tests__/
│   │   └── activeProbe.unit.test.ts ← Probe provider tests
│   └── activeProbe.ts
├── storage/
│   ├── __tests__/
│   │   └── envPairDO.test.ts      ← DO storage tests
│   └── envPairDO.ts
└── ...
```

---

## Documentation

- [STEP_7_TEST_SUITE.md](STEP_7_TEST_SUITE.md) - Complete test documentation
- [CLAUDE.md](CLAUDE.md) - System rulebook
- [PHASE_B4_IMPLEMENTATION_FINAL.md](PHASE_B4_IMPLEMENTATION_FINAL.md) - Implementation details

---

## Success Criteria

✅ All 200+ tests pass
✅ SSRF validation rejects all dangerous IPs
✅ /api/probe endpoint returns 404
✅ Valid public URLs are accepted
✅ Manual curl tests all pass
✅ No TypeScript errors
✅ No console warnings

