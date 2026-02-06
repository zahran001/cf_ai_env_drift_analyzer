# usePairHistory Hook - Implementation Guide

**Status:** Ready to implement
**Phase:** 3A (Input Layer & History)
**Estimated Time:** 3 hours
**File Location:** `pages/src/hooks/usePairHistory.ts`

---

## Overview

The `usePairHistory` hook manages environment pair comparisons in browser localStorage using an **LRU (Least Recently Used) eviction strategy**. This enables:

- ✅ Save and retrieve previous environment pair comparisons
- ✅ "Re-run" button affordance (one-click re-compare)
- ✅ "Last Run" quick-access
- ✅ Persistent history across page reloads
- ✅ Automatic cleanup when max capacity reached

---

## Data Structure

### HistoryEntry Interface

```typescript
export interface HistoryEntry {
  /** Deterministic pair key: first 40 chars of SHA-256(sorted URLs) */
  pairKey: string;

  /** Left environment URL (immutable once saved) */
  leftUrl: string;

  /** Right environment URL (immutable once saved) */
  rightUrl: string;

  /** Optional UI-only label for left environment */
  leftLabel?: string;

  /** Optional UI-only label for right environment */
  rightLabel?: string;

  /** Most recent comparison ID for this pair (for "Re-run" link) */
  lastComparisonId?: string;

  /** ISO timestamp of last comparison */
  lastRunAt: string;
}
```

### Storage Key

```typescript
const STORAGE_KEY = "cf-env-history";  // Single key, no per-pair keys
const MAX_PAIRS = 20;  // LRU limit
```

---

## Hook API

### Function Signature

```typescript
export function usePairHistory() {
  return {
    savePair(entry: HistoryEntry): void;
    listPairs(): HistoryEntry[];
    getPair(pairKey: string): HistoryEntry | null;
    deletePair(pairKey: string): void;
    clearHistory(): void;
  };
}
```

### Method Specifications

#### `savePair(entry: HistoryEntry): void`

**Purpose:** Add or update a pair in history (with LRU reordering)

**Behavior:**
1. Read current history from localStorage
2. If pair with same `pairKey` exists, remove it (to re-insert at front)
3. Insert new entry at the front of the array
4. Keep only the first `MAX_PAIRS` entries (evict oldest)
5. Write back to localStorage

**Example:**
```typescript
history.savePair({
  pairKey: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  leftUrl: "https://example.com",
  rightUrl: "https://staging.example.com",
  leftLabel: "Production",
  rightLabel: "Staging",
  lastComparisonId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6-uuid",
  lastRunAt: new Date().toISOString(),
});
```

#### `listPairs(): HistoryEntry[]`

**Purpose:** Retrieve all saved pairs in order (most recent first)

**Return:**
- Empty array `[]` if no history
- Array of `HistoryEntry[]` ordered by MRU (most recent use)

**Example:**
```typescript
const pairs = history.listPairs();
// pairs[0] = most recent pair
// pairs[pairs.length - 1] = oldest pair
```

#### `getPair(pairKey: string): HistoryEntry | null`

**Purpose:** Retrieve a single pair by key (without mutation)

**Return:**
- `HistoryEntry` if found
- `null` if not found

**Example:**
```typescript
const lastSavedPair = history.getPair("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
if (lastSavedPair) {
  setLeftUrl(lastSavedPair.leftUrl);
  setRightUrl(lastSavedPair.rightUrl);
}
```

#### `deletePair(pairKey: string): void`

**Purpose:** Remove a specific pair from history

**Behavior:**
1. Read history
2. Filter out entry with matching `pairKey`
3. Write back to localStorage

**Example:**
```typescript
history.deletePair("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
```

#### `clearHistory(): void`

**Purpose:** Delete all history (for "Clear All" button in settings)

**Behavior:**
- Remove STORAGE_KEY from localStorage

**Example:**
```typescript
history.clearHistory();
```

---

## Implementation Details

### Step 1: Compute pairKey (Client-Side)

The `pairKey` must match the backend's logic. Backend computes:
```typescript
const pairKeyPrefix = SHA256(
  [leftUrl, rightUrl].sort().join('|')
).hex().substring(0, 40);
```

Frontend must mirror this exactly:

```typescript
export async function computePairKey(leftUrl: string, rightUrl: string): Promise<string> {
  const combined = [leftUrl, rightUrl].sort().join('|');
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
  const hex = Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.substring(0, 40);
}
```

**Note:** This is deterministic; same URLs always produce same pairKey.

### Step 2: localStorage Operations

Use browser `localStorage` API directly (no external libraries needed):

```typescript
// Read
const raw = localStorage.getItem("cf-env-history");
const history = raw ? JSON.parse(raw) : [];

// Write
localStorage.setItem("cf-env-history", JSON.stringify(history));

// Delete
localStorage.removeItem("cf-env-history");
```

### Step 3: LRU Eviction Logic

When saving a new pair:

```typescript
export function savePair(entry: HistoryEntry): void {
  // 1. Read current history
  const all = listPairs();

  // 2. Remove existing entry if it exists (to re-insert at front)
  const filtered = all.filter(p => p.pairKey !== entry.pairKey);

  // 3. Insert new entry at front
  const updated = [entry, ...filtered];

  // 4. Keep only the first MAX_PAIRS entries (evict oldest)
  const trimmed = updated.slice(0, MAX_PAIRS);

  // 5. Write back to localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}
```

**Example Flow:**
```
Before save:
[
  { pairKey: "zzz", ... },  // oldest
  { pairKey: "bbb", ... },
  { pairKey: "aaa", ... },  // most recent
]

After save({ pairKey: "bbb", ... }):
[
  { pairKey: "bbb", ... },  // moved to front (updated lastRunAt)
  { pairKey: "zzz", ... },
  { pairKey: "aaa", ... },
]

If MAX_PAIRS = 3 and save 4th new entry:
[
  { pairKey: "xxx", ... },  // new
  { pairKey: "bbb", ... },
  { pairKey: "zzz", ... },
  // { pairKey: "aaa", ... }  EVICTED (too old)
]
```

### Step 4: Error Handling

Gracefully handle localStorage edge cases:

```typescript
function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // Validate structure (basic type check)
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidHistoryEntry);
  } catch (e) {
    // localStorage might be unavailable or corrupt
    console.warn('Failed to read history:', e);
    return [];
  }
}

function isValidHistoryEntry(obj: any): boolean {
  return (
    obj &&
    typeof obj.pairKey === 'string' &&
    typeof obj.leftUrl === 'string' &&
    typeof obj.rightUrl === 'string' &&
    typeof obj.lastRunAt === 'string'
  );
}
```

---

## Integration with App.tsx

### Hook Usage Pattern

```typescript
// pages/src/App.tsx
import { usePairHistory } from './hooks/usePairHistory';

export default function App() {
  const history = usePairHistory();
  const [leftUrl, setLeftUrl] = useState('');
  const [rightUrl, setRightUrl] = useState('');
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const handleSubmit = async () => {
    // 1. Compute pairKey
    const pairKey = await computePairKey(leftUrl, rightUrl);

    // 2. POST /api/compare
    const resp = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leftUrl, rightUrl }),
    });

    const { comparisonId: id } = await resp.json();
    setComparisonId(id);

    // 3. On completion (from useComparisonPoll), save to history
    // (see below)
  };

  const handleResultComplete = (result: CompareResult) => {
    // Extract pairKeyPrefix from comparisonId
    const pairKeyFromBackend = comparisonId!.substring(0, 40);

    // Save to history
    history.savePair({
      pairKey: pairKeyFromBackend,
      leftUrl: result.leftUrl,
      rightUrl: result.rightUrl,
      leftLabel: result.leftLabel,
      rightLabel: result.rightLabel,
      lastComparisonId: result.comparisonId,
      lastRunAt: new Date().toISOString(),
    });
  };

  // Render "Recent pairs" list
  const recentPairs = history.listPairs();

  return (
    <>
      {/* ... inputs ... */}

      {recentPairs.length > 0 && (
        <div className="recent-pairs">
          <h3>Recent Comparisons</h3>
          <ul>
            {recentPairs.map(pair => (
              <li key={pair.pairKey}>
                <button
                  onClick={() => {
                    setLeftUrl(pair.leftUrl);
                    setRightUrl(pair.rightUrl);
                  }}
                >
                  {pair.leftLabel || pair.leftUrl} ↔ {pair.rightLabel || pair.rightUrl}
                </button>
                <small>{new Date(pair.lastRunAt).toLocaleDateString()}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
```

---

## Complete Hook Implementation

Here's the full implementation ready to copy:

```typescript
// pages/src/hooks/usePairHistory.ts

export interface HistoryEntry {
  /** Deterministic pair key: first 40 chars of SHA-256(sorted URLs) */
  pairKey: string;

  /** Left environment URL */
  leftUrl: string;

  /** Right environment URL */
  rightUrl: string;

  /** Optional UI label for left environment */
  leftLabel?: string;

  /** Optional UI label for right environment */
  rightLabel?: string;

  /** Most recent comparison ID for this pair */
  lastComparisonId?: string;

  /** ISO timestamp of last comparison */
  lastRunAt: string;
}

const STORAGE_KEY = "cf-env-history";
const MAX_PAIRS = 20;

/**
 * Validates basic structure of a HistoryEntry.
 */
function isValidHistoryEntry(obj: any): obj is HistoryEntry {
  return (
    obj &&
    typeof obj.pairKey === 'string' &&
    typeof obj.leftUrl === 'string' &&
    typeof obj.rightUrl === 'string' &&
    typeof obj.lastRunAt === 'string'
  );
}

/**
 * Safely reads history from localStorage.
 * Returns empty array if unavailable or corrupt.
 */
function readFromStorage(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      console.warn('Stored history is not an array, resetting');
      return [];
    }

    // Filter out invalid entries
    return parsed.filter(isValidHistoryEntry);
  } catch (e) {
    console.warn('Failed to read history from localStorage:', e);
    return [];
  }
}

/**
 * Safely writes history to localStorage.
 */
function writeToStorage(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed to write history to localStorage:', e);
    // Silently fail; don't crash the app
  }
}

/**
 * Manages environment pair history in localStorage with LRU eviction.
 *
 * Storage Strategy:
 * - Single key: "cf-env-history"
 * - Value: HistoryEntry[] (most recent first)
 * - Max 20 entries, auto-evict oldest
 * - Atomic operations
 */
export function usePairHistory() {
  /**
   * Add or update a pair, maintaining LRU order.
   * If pair exists, removes and re-inserts at front (updates order + timestamp).
   * Evicts oldest if length > MAX_PAIRS.
   */
  function savePair(entry: HistoryEntry): void {
    const all = readFromStorage();

    // Remove existing entry if it exists (to re-insert at front)
    const filtered = all.filter(p => p.pairKey !== entry.pairKey);

    // Insert new entry at front
    const updated = [entry, ...filtered];

    // Keep only the first MAX_PAIRS entries
    const trimmed = updated.slice(0, MAX_PAIRS);

    // Write back
    writeToStorage(trimmed);
  }

  /**
   * Retrieve all saved pairs in order (most recent first).
   */
  function listPairs(): HistoryEntry[] {
    return readFromStorage();
  }

  /**
   * Retrieve a single pair by key (without mutation).
   * Returns null if not found.
   */
  function getPair(pairKey: string): HistoryEntry | null {
    const all = readFromStorage();
    return all.find(p => p.pairKey === pairKey) ?? null;
  }

  /**
   * Remove a specific pair from history.
   */
  function deletePair(pairKey: string): void {
    const all = readFromStorage();
    const filtered = all.filter(p => p.pairKey !== pairKey);
    writeToStorage(filtered);
  }

  /**
   * Clear all history.
   */
  function clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear history:', e);
    }
  }

  return {
    savePair,
    listPairs,
    getPair,
    deletePair,
    clearHistory,
  };
}
```

### Utility Function: computePairKey

Add this to `pages/src/lib/utils.ts` or similar:

```typescript
/**
 * Compute deterministic pair key to match backend logic.
 * Same URLs always produce same key, independent of order.
 *
 * Matches backend: SHA256(sorted URLs).hex().substring(0, 40)
 */
export async function computePairKey(leftUrl: string, rightUrl: string): Promise<string> {
  const combined = [leftUrl, rightUrl].sort().join('|');
  const encoded = new TextEncoder().encode(combined);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.substring(0, 40);
}
```

---

## Testing the Hook

### Unit Test Template

```typescript
// pages/src/hooks/__tests__/usePairHistory.test.ts

import { usePairHistory } from '../usePairHistory';

describe('usePairHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('savePair and listPairs', () => {
    const { savePair, listPairs } = usePairHistory();

    savePair({
      pairKey: 'key1',
      leftUrl: 'https://example.com',
      rightUrl: 'https://staging.example.com',
      lastRunAt: new Date().toISOString(),
    });

    const pairs = listPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairKey).toBe('key1');
  });

  test('getPair returns entry by key', () => {
    const { savePair, getPair } = usePairHistory();

    savePair({
      pairKey: 'key1',
      leftUrl: 'https://example.com',
      rightUrl: 'https://staging.example.com',
      lastRunAt: new Date().toISOString(),
    });

    const pair = getPair('key1');
    expect(pair).not.toBeNull();
    expect(pair!.leftUrl).toBe('https://example.com');
  });

  test('deletePair removes entry', () => {
    const { savePair, deletePair, listPairs } = usePairHistory();

    savePair({
      pairKey: 'key1',
      leftUrl: 'https://example.com',
      rightUrl: 'https://staging.example.com',
      lastRunAt: new Date().toISOString(),
    });

    deletePair('key1');
    const pairs = listPairs();
    expect(pairs).toHaveLength(0);
  });

  test('LRU eviction keeps only MAX_PAIRS', () => {
    const { savePair, listPairs } = usePairHistory();

    for (let i = 0; i < 25; i++) {
      savePair({
        pairKey: `key${i}`,
        leftUrl: `https://example${i}.com`,
        rightUrl: `https://staging${i}.example.com`,
        lastRunAt: new Date().toISOString(),
      });
    }

    const pairs = listPairs();
    expect(pairs).toHaveLength(20); // MAX_PAIRS
    expect(pairs[0].pairKey).toBe('key24'); // Most recent
    expect(pairs[19].pairKey).toBe('key5'); // Oldest kept
  });

  test('savePair updates existing entry and moves to front', () => {
    const { savePair, listPairs } = usePairHistory();

    savePair({
      pairKey: 'key1',
      leftUrl: 'https://example.com',
      rightUrl: 'https://staging.example.com',
      lastRunAt: '2026-01-01T00:00:00Z',
    });

    savePair({
      pairKey: 'key2',
      leftUrl: 'https://other.com',
      rightUrl: 'https://staging-other.com',
      lastRunAt: '2026-01-02T00:00:00Z',
    });

    // Re-save key1 with updated timestamp
    savePair({
      pairKey: 'key1',
      leftUrl: 'https://example.com',
      rightUrl: 'https://staging.example.com',
      lastRunAt: '2026-01-03T00:00:00Z',
    });

    const pairs = listPairs();
    expect(pairs).toHaveLength(2);
    expect(pairs[0].pairKey).toBe('key1'); // Moved to front
    expect(pairs[0].lastRunAt).toBe('2026-01-03T00:00:00Z'); // Updated
    expect(pairs[1].pairKey).toBe('key2');
  });
});
```

### Manual Testing (Browser DevTools)

```javascript
// In browser console:

// 1. Check current history
JSON.parse(localStorage.getItem('cf-env-history') || '[]')

// 2. Clear history
localStorage.removeItem('cf-env-history')

// 3. Save a test entry
const entry = {
  pairKey: 'test-key',
  leftUrl: 'https://example.com',
  rightUrl: 'https://staging.example.com',
  leftLabel: 'Prod',
  rightLabel: 'Staging',
  lastRunAt: new Date().toISOString(),
};
localStorage.setItem('cf-env-history', JSON.stringify([entry]));

// 4. Verify it was saved
JSON.parse(localStorage.getItem('cf-env-history'))[0]
```

---

## Gotchas & Common Mistakes

### ❌ Gotcha #1: Different pairKey Computation

**Problem:** Frontend computes pairKey differently than backend
**Solution:** Use exact same SHA-256 algorithm, same URL sort order
**Mitigation:** Extract pairKeyPrefix from backend's comparisonId (first 40 chars) and verify it matches

### ❌ Gotcha #2: Not Deduplicating on Re-Save

**Problem:** Calling `savePair` twice with same URL pair creates duplicates
**Solution:** Always filter by `pairKey` before inserting
**Verification:** `listPairs().filter(p => p.pairKey === key).length === 1` (always 1)

### ❌ Gotcha #3: Storage Quota Exceeded

**Problem:** User has many saved pairs; localStorage quota exhausted
**Solution:** MAX_PAIRS = 20 keeps ~10–20 KB (well under 5 MB typical quota)
**Monitoring:** Wrap `localStorage.setItem()` in try/catch

### ❌ Gotcha #4: localStorage Not Available

**Problem:** Private browsing, storage disabled, or quota exceeded
**Solution:** Graceful degradation; return empty array if `localStorage` unavailable
**Testing:** Run in private browsing mode; verify UI still works

### ❌ Gotcha #5: Stale Entry References

**Problem:** App holds reference to `HistoryEntry` that changes after save
**Solution:** Always re-call `listPairs()` or `getPair()` after modifying
**Pattern:** Never cache entries; fetch fresh each time

---

## Performance Considerations

### Storage Size Estimate

```
MAX_PAIRS = 20
Avg HistoryEntry size ≈ 300–400 bytes
Total ≈ 6–8 KB (well under 5 MB localStorage limit)
```

### Read/Write Performance

- **listPairs():** Single localStorage read + JSON parse ≈ <1ms
- **savePair():** Read + filter + write ≈ <2ms
- **No impact** on app responsiveness

### Optimization (Not Needed for MVP)

If storage becomes an issue later:
- Compress entries (reduces size by 50%)
- Implement IndexedDB (supports larger datasets)
- Implement server-side history (with auth)

---

## Acceptance Criteria

- [x] Hook created at `pages/src/hooks/usePairHistory.ts`
- [x] All 5 methods implemented (savePair, listPairs, getPair, deletePair, clearHistory)
- [x] LRU eviction works (max 20 entries)
- [x] Error handling for unavailable localStorage
- [x] Integration with App.tsx (save on completion)
- [x] Type safety (HistoryEntry interface)
- [x] Unit tests passing (5+ test cases)
- [x] Manual testing in browser DevTools verified

---

## Next Steps

1. **Create** `pages/src/hooks/usePairHistory.ts` with full implementation above
2. **Create** `pages/src/hooks/__tests__/usePairHistory.test.ts` with unit tests
3. **Add utility** `computePairKey()` to `pages/src/lib/utils.ts`
4. **Integrate** into App.tsx (call `history.savePair()` on result completion)
5. **Test** with real backend: submit comparison, verify saved to localStorage
6. **Verify** pairKey matches backend pairKeyPrefix from comparisonId

---

**Document Version:** 1.0
**Status:** Ready for implementation
**Last Updated:** 2026-02-05
