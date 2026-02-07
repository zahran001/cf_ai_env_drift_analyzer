# Frontend Testing Setup (Pages)

## Overview

This directory uses **Jest** with **ts-jest** for unit testing React components and hooks. The setup is independent from the backend Jest configuration.

## Configuration

**Config File:** `jest.config.cjs`

Key settings:
- **Test Environment:** Node.js (for hook logic testing without browser)
- **Test Pattern:** `**/*.test.ts` and `**/*.test.tsx`
- **Module Aliases:**
  - `@shared/*` → `../shared/*` (shared types)
  - `@/*` → `src/*` (local imports)
- **TypeScript:** Configured to use `ts-jest` with JSX support

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-run on file changes)
npm test:watch

# Generate coverage report
npm test:coverage
```

## Test Organization

Tests are colocated with their source files:
- `src/hooks/usePairHistory.ts` → `src/hooks/usePairHistory.test.ts`
- Future: `src/components/SearchBox.tsx` → `src/components/SearchBox.test.tsx`

## Current Test Suites

### usePairHistory Hook Logic (12 tests, all passing)

**Location:** `src/hooks/usePairHistory.test.ts`

Covers:
- Save functionality with deduplication and LRU eviction
- List operations with MRU ordering
- Retrieval by key
- Deletion with idempotency
- localStorage persistence and recovery

**Status:** ✅ All 12 tests passing

## Dependencies

Key testing packages:
- `jest@^29.7.0` - Test runner
- `ts-jest@^29.1.1` - TypeScript support
- `@jest/globals@^29.7.0` - Jest type globals
- `@types/jest@^29.5.11` - Jest types
- `jest-environment-jsdom@^29.7.0` - DOM testing (if needed later)
- `@testing-library/react@^16.1.0` - React component testing (if needed later)

## Notes

- Tests use Node.js test environment (no jsdom) for hook logic testing
- React hook integration tests can use jsdom later if needed
- All imports use `@shared/*` alias for shared types
- No browser APIs required for current test suite
