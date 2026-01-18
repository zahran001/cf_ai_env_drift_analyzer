#!/bin/bash

# Step 7 Manual Testing Script
# Assumes wrangler dev is running on http://localhost:8787
# Run this in a separate terminal while wrangler dev is active

set -e

BASE_URL="http://localhost:8787"
PASS=0
FAIL=0
RESULTS_FILE="STEP_7_MANUAL_TEST_RESULTS.txt"

echo "========================================" | tee "$RESULTS_FILE"
echo "Step 7 Manual Testing" | tee -a "$RESULTS_FILE"
echo "$(date)" | tee -a "$RESULTS_FILE"
echo "========================================" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Helper function to test endpoint
test_endpoint() {
  local test_name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  local expected_status="$5"
  local expected_contains="$6"

  echo -n "Test: $test_name ... "

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$BASE_URL$endpoint")
  fi

  status_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [ "$status_code" = "$expected_status" ]; then
    if [ -z "$expected_contains" ] || echo "$body" | grep -q "$expected_contains"; then
      echo "✅ PASS"
      echo "  Status: $status_code" | tee -a "$RESULTS_FILE"
      echo "  Response: $(echo "$body" | jq -r . 2>/dev/null || echo "$body" | head -c 100)" | tee -a "$RESULTS_FILE"
      PASS=$((PASS + 1))
    else
      echo "❌ FAIL (Content mismatch)"
      echo "  Expected to contain: $expected_contains" | tee -a "$RESULTS_FILE"
      echo "  Response: $body" | tee -a "$RESULTS_FILE"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "❌ FAIL (Status mismatch)"
    echo "  Expected: $expected_status, Got: $status_code" | tee -a "$RESULTS_FILE"
    echo "  Response: $body" | tee -a "$RESULTS_FILE"
    FAIL=$((FAIL + 1))
  fi

  echo "" | tee -a "$RESULTS_FILE"
}

# Test 1: Health Check
test_endpoint \
  "1. Health Check" \
  "GET" \
  "/api/health" \
  "" \
  "200" \
  '"ok":true'

# Test 2: Valid Comparison
test_endpoint \
  "2. Valid Comparison Request" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"https://example.com","rightUrl":"https://cloudflare.com"}' \
  "202" \
  "comparisonId"

# Save comparisonId for Test 3
COMPARISON_ID=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://cloudflare.com"}' \
  "$BASE_URL/api/compare" | jq -r '.comparisonId')

echo "Captured comparisonId: $COMPARISON_ID" | tee -a "$RESULTS_FILE"

# Test 3: Poll Non-Existent (Should return 404)
test_endpoint \
  "3. Poll Non-Existent Comparison (404 Expected)" \
  "GET" \
  "/api/compare/nonexistent:uuid-here" \
  "" \
  "404" \
  "not found"

# Test 4: Localhost Rejection
test_endpoint \
  "4. Reject Localhost (leftUrl)" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"http://localhost","rightUrl":"https://example.com"}' \
  "400" \
  "Localhost"

# Test 5: Private IP Rejection (10.x.x.x)
test_endpoint \
  "5. Reject Private IP 10.x.x.x" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"http://10.0.0.1","rightUrl":"https://example.com"}' \
  "400" \
  "Private IP"

# Test 6: Private IP Rejection (192.168.x.x)
test_endpoint \
  "6. Reject Private IP 192.168.x.x" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"https://example.com","rightUrl":"http://192.168.1.1"}' \
  "400" \
  "Private IP"

# Test 7: Numeric Bypass Rejection (Decimal)
test_endpoint \
  "7. Reject Numeric Bypass (Decimal)" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"http://2130706433","rightUrl":"https://example.com"}' \
  "400" \
  "bypass"

# Test 8: Scheme Rejection (file://)
test_endpoint \
  "8. Reject Unsupported Scheme (file://)" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"file:///etc/passwd","rightUrl":"https://example.com"}' \
  "400" \
  "scheme"

# Test 9: Link-Local Rejection (169.254.x.x)
test_endpoint \
  "9. Reject Link-Local IP" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"http://169.254.0.1","rightUrl":"https://example.com"}' \
  "400" \
  "Link-local"

# Test 10: Hex Bypass Rejection
test_endpoint \
  "10. Reject Numeric Bypass (Hex)" \
  "POST" \
  "/api/compare" \
  '{"leftUrl":"http://0x7f000001","rightUrl":"https://example.com"}' \
  "400" \
  "bypass"

# Test 11: Missing Field
test_endpoint \
  "11. Reject Missing leftUrl" \
  "POST" \
  "/api/compare" \
  '{"rightUrl":"https://example.com"}' \
  "400" \
  "Missing"

# Test 12: Unknown Route
test_endpoint \
  "12. 404 for Unknown Route" \
  "GET" \
  "/api/unknown" \
  "" \
  "404" \
  ""

# Test 13: Determinism - Same pairKey
echo "Test 13: Determinism Check (Same URLs = Same pairKey)"
ID1=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://api.github.com","rightUrl":"https://gitlab.com"}' \
  "$BASE_URL/api/compare" | jq -r '.comparisonId')

ID2=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://api.github.com","rightUrl":"https://gitlab.com"}' \
  "$BASE_URL/api/compare" | jq -r '.comparisonId')

PAIRKEY1=$(echo "$ID1" | cut -d: -f1)
PAIRKEY2=$(echo "$ID2" | cut -d: -f1)

if [ "$PAIRKEY1" = "$PAIRKEY2" ]; then
  echo "✅ PASS: Same URLs → Same pairKey" | tee -a "$RESULTS_FILE"
  echo "  ID1: $ID1" | tee -a "$RESULTS_FILE"
  echo "  ID2: $ID2" | tee -a "$RESULTS_FILE"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: pairKeys differ" | tee -a "$RESULTS_FILE"
  echo "  ID1: $ID1" | tee -a "$RESULTS_FILE"
  echo "  ID2: $ID2" | tee -a "$RESULTS_FILE"
  FAIL=$((FAIL + 1))
fi
echo "" | tee -a "$RESULTS_FILE"

# Test 14: Order-Invariance
echo "Test 14: Order-Invariance Check ((A,B) == (B,A))"
ID_AB=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://google.com","rightUrl":"https://twitter.com"}' \
  "$BASE_URL/api/compare" | jq -r '.comparisonId')

ID_BA=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://twitter.com","rightUrl":"https://google.com"}' \
  "$BASE_URL/api/compare" | jq -r '.comparisonId')

PAIRKEY_AB=$(echo "$ID_AB" | cut -d: -f1)
PAIRKEY_BA=$(echo "$ID_BA" | cut -d: -f1)

if [ "$PAIRKEY_AB" = "$PAIRKEY_BA" ]; then
  echo "✅ PASS: Order-invariant pairKey" | tee -a "$RESULTS_FILE"
  echo "  (A,B): $ID_AB" | tee -a "$RESULTS_FILE"
  echo "  (B,A): $ID_BA" | tee -a "$RESULTS_FILE"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: pairKeys differ (should be order-invariant)" | tee -a "$RESULTS_FILE"
  echo "  (A,B): $ID_AB" | tee -a "$RESULTS_FILE"
  echo "  (B,A): $ID_BA" | tee -a "$RESULTS_FILE"
  FAIL=$((FAIL + 1))
fi
echo "" | tee -a "$RESULTS_FILE"

# Summary
echo "========================================" | tee -a "$RESULTS_FILE"
echo "Test Summary" | tee -a "$RESULTS_FILE"
echo "========================================" | tee -a "$RESULTS_FILE"
echo "Passed: $PASS" | tee -a "$RESULTS_FILE"
echo "Failed: $FAIL" | tee -a "$RESULTS_FILE"
echo "Total:  $((PASS + FAIL))" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED" | tee -a "$RESULTS_FILE"
  exit 0
else
  echo "❌ SOME TESTS FAILED" | tee -a "$RESULTS_FILE"
  exit 1
fi
