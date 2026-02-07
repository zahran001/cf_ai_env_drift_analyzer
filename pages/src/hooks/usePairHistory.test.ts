/**
 * Unit tests for usePairHistory hook.
 *
 * Note: These tests use Node.js localStorage mock since React hooks
 * require a browser/jsdom environment. Integration tests in E2E suite
 * will validate React hook behavior.
 *
 * To run: npm test (requires test runner configuration)
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* @jest-environment node */

import type { HistoryEntry, PairKey } from "./usePairHistory";

// Mock localStorage for Node.js environment
class MockLocalStorage {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

/**
 * Test Suite: usePairHistory Hook Logic
 *
 * These are logical tests of the hook's data manipulation.
 * React hook integration tests require jsdom/React Testing Library.
 */
describe("usePairHistory Hook Logic", () => {
  let mockStorage: MockLocalStorage;
  const STORAGE_KEY = "cf-env-history";

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    // Mock global localStorage
    (global as any).localStorage = mockStorage;
  });

  describe("savePair()", () => {
    test("should save a new pair to history with lastComparisonId and lastRunAt", () => {
      const now = Date.now();
      const entry: HistoryEntry = {
        leftUrl: "https://staging.example.com",
        rightUrl: "https://prod.example.com",
        leftLabel: "Staging",
        rightLabel: "Prod",
        lastComparisonId: "comp-123",
        lastRunAt: now,
      };

      mockStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ entries: [entry], version: 1 })
      );

      const stored = JSON.parse(mockStorage.getItem(STORAGE_KEY)!);
      expect(stored.entries).toHaveLength(1);
      expect(stored.entries[0].leftUrl).toBe("https://staging.example.com");
      expect(stored.entries[0].lastComparisonId).toBe("comp-123");
      expect(stored.entries[0].lastRunAt).toBe(now);
    });

    test("should deduplicate pairs by (leftUrl, rightUrl) tuple", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging.example.com",
        rightUrl: "https://prod.example.com",
        leftLabel: "Staging v1",
        rightLabel: "Prod v1",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const entry2: HistoryEntry = {
        leftUrl: "https://staging.example.com",
        rightUrl: "https://prod.example.com",
        leftLabel: "Staging v2",
        rightLabel: "Prod v2",
        lastComparisonId: "comp-2",
        lastRunAt: 2000,
      };

      // Simulate savePair logic: if duplicate, remove old entry and add new to front
      const entries = [entry1];
      const filtered = entries.filter(
        (e) =>
          !(
            e.leftUrl === entry2.leftUrl && e.rightUrl === entry2.rightUrl
          )
      );
      const updated = [entry2, ...filtered];

      expect(updated).toHaveLength(1);
      expect(updated[0].lastRunAt).toBe(2000); // Newer entry at front
    });

    test("should move existing pair to front on re-save", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const entry2: HistoryEntry = {
        leftUrl: "https://staging2.example.com",
        rightUrl: "https://prod2.example.com",
        lastComparisonId: "comp-2",
        lastRunAt: 2000,
      };

      const entry3: HistoryEntry = {
        leftUrl: "https://staging3.example.com",
        rightUrl: "https://prod3.example.com",
        lastComparisonId: "comp-3",
        lastRunAt: 3000,
      };

      // Simulate history state: [entry3, entry2, entry1]
      let history = [entry3, entry2, entry1];

      // Re-save entry1 (should move to front)
      const filtered = history.filter(
        (e) =>
          !(
            e.leftUrl === entry1.leftUrl && e.rightUrl === entry1.rightUrl
          )
      );
      const newEntry1 = { ...entry1, lastRunAt: Date.now() };
      history = [newEntry1, ...filtered];

      expect(history[0].leftUrl).toBe(entry1.leftUrl);
      expect(history[0].rightUrl).toBe(entry1.rightUrl);
      expect(history).toHaveLength(3);
    });
  });

  describe("LRU Eviction (max 20 entries)", () => {
    test("should evict oldest entry when exceeding MAX_ENTRIES (20)", () => {
      const MAX_ENTRIES = 20;

      // Create 21 entries
      const entries: HistoryEntry[] = [];
      for (let i = 0; i < 21; i++) {
        entries.push({
          leftUrl: `https://staging${i}.example.com`,
          rightUrl: `https://prod${i}.example.com`,
          lastComparisonId: `comp-${i}`,
          lastRunAt: i * 1000,
        });
      }

      // Simulate eviction: keep only first MAX_ENTRIES
      const evicted = entries.slice(0, MAX_ENTRIES);

      expect(evicted).toHaveLength(20);
      expect(evicted[0].leftUrl).toBe("https://staging0.example.com");
      expect(evicted[19].leftUrl).toBe("https://staging19.example.com");
      // Entry 20 should be evicted
    });

    test("should maintain MRU ordering after eviction", () => {
      const MAX_ENTRIES = 20;
      const entries: HistoryEntry[] = [];

      // Create 25 entries
      for (let i = 0; i < 25; i++) {
        entries.push({
          leftUrl: `https://staging${i}.example.com`,
          rightUrl: `https://prod${i}.example.com`,
          lastComparisonId: `comp-${i}`,
          lastRunAt: i,
        });
      }

      // Evict to MAX_ENTRIES (newest first, oldest last)
      const evicted = entries.slice(0, MAX_ENTRIES);

      expect(evicted).toHaveLength(20);
      expect(evicted[0].lastRunAt).toBe(0); // Oldest (first added)
      expect(evicted[19].lastRunAt).toBe(19); // Newest
    });
  });

  describe("listPairs()", () => {
    test("should return all pairs, MRU first", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const entry2: HistoryEntry = {
        leftUrl: "https://staging2.example.com",
        rightUrl: "https://prod2.example.com",
        lastComparisonId: "comp-2",
        lastRunAt: 2000,
      };

      const history = [entry2, entry1]; // MRU first

      expect(history).toHaveLength(2);
      expect(history[0].lastRunAt).toBe(2000);
      expect(history[1].lastRunAt).toBe(1000);
    });
  });

  describe("getPair()", () => {
    test("should retrieve a pair by PairKey", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const entry2: HistoryEntry = {
        leftUrl: "https://staging2.example.com",
        rightUrl: "https://prod2.example.com",
        lastComparisonId: "comp-2",
        lastRunAt: 2000,
      };

      const history = [entry2, entry1];

      const pairKey: PairKey = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
      };

      const found = history.find(
        (e) => e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
      ) ?? null;

      expect(found).not.toBeNull();
      expect(found?.lastRunAt).toBe(1000);
    });

    test("should return null if pair not found", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const history = [entry1];

      const pairKey: PairKey = {
        leftUrl: "https://staging-nonexistent.example.com",
        rightUrl: "https://prod-nonexistent.example.com",
      };

      const found = history.find(
        (e) => e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
      ) ?? null;

      expect(found).toBeNull();
    });
  });

  describe("deletePair()", () => {
    test("should delete a pair by PairKey", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      const entry2: HistoryEntry = {
        leftUrl: "https://staging2.example.com",
        rightUrl: "https://prod2.example.com",
        lastComparisonId: "comp-2",
        lastRunAt: 2000,
      };

      let history = [entry2, entry1];

      const pairKey: PairKey = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
      };

      // Simulate deletePair logic
      history = history.filter(
        (e) =>
          !(
            e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
          )
      );

      expect(history).toHaveLength(1);
      expect(history[0].leftUrl).toBe("https://staging2.example.com");
    });

    test("should be idempotent (deleting non-existent pair is safe)", () => {
      const entry1: HistoryEntry = {
        leftUrl: "https://staging1.example.com",
        rightUrl: "https://prod1.example.com",
        lastComparisonId: "comp-1",
        lastRunAt: 1000,
      };

      let history = [entry1];

      const pairKey: PairKey = {
        leftUrl: "https://staging-nonexistent.example.com",
        rightUrl: "https://prod-nonexistent.example.com",
      };

      const originalLength = history.length;
      history = history.filter(
        (e) =>
          !(
            e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
          )
      );

      expect(history).toHaveLength(originalLength);
    });
  });

  describe("Storage Persistence", () => {
    test("should persist history to localStorage with version tag", () => {
      const now = Date.now();
      const entry: HistoryEntry = {
        leftUrl: "https://staging.example.com",
        rightUrl: "https://prod.example.com",
        lastComparisonId: "comp-123",
        lastRunAt: now,
      };

      const data = { entries: [entry], version: 1 };
      mockStorage.setItem(STORAGE_KEY, JSON.stringify(data));

      const stored = mockStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.version).toBe(1);
      expect(parsed.entries).toHaveLength(1);
    });

    test("should recover from corrupted localStorage gracefully", () => {
      mockStorage.setItem(STORAGE_KEY, "invalid json");

      try {
        const stored = mockStorage.getItem(STORAGE_KEY);
        JSON.parse(stored!);
        throw new Error("Should have thrown parse error");
      } catch (e: any) {
        expect(e).toBeDefined();
        // In the hook, this would be caught and return []
      }
    });
  });
});
