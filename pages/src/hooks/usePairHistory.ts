/// <reference types="vite/client" />

import { useCallback, useState } from "react";

const STORAGE_KEY = "cf-env-history";
const MAX_ENTRIES = 20;

export interface HistoryEntry {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  lastComparisonId: string;
  lastRunAt: number;
}

/**
 * Pair key tuple: (leftUrl, rightUrl).
 * Used as unique identifier for deduplication.
 */
export interface PairKey {
  leftUrl: string;
  rightUrl: string;
}

interface StoredHistory {
  entries: HistoryEntry[];
  version: number;
}

/**
 * Manages browser localStorage for comparison pair history.
 * Implements LRU (Least Recently Used) eviction: max 20 entries.
 * All operations synchronous (no async IO).
 * Silently degrades if localStorage unavailable (e.g., private browsing, quota exceeded).
 */
export function usePairHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed: StoredHistory = JSON.parse(stored);
      if (!Array.isArray(parsed.entries)) return [];
      return parsed.entries;
    } catch {
      return [];
    }
  });

  /**
   * Persist current history to localStorage.
   * Silently degrades if storage unavailable.
   */
  const persistHistory = useCallback((entries: HistoryEntry[]): void => {
    try {
      const data: StoredHistory = {
        entries,
        version: 1,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[usePairHistory] Failed to persist to localStorage:", err);
      }
    }
  }, []);

  /**
   * Save a new comparison pair to history.
   * Deduplicates by (leftUrl, rightUrl) tuple.
   * Moves existing pair to front, or adds new pair to front.
   * Implements LRU eviction: if total > MAX_ENTRIES, remove oldest (last item).
   */
  const savePair = useCallback(
    (
      leftUrl: string,
      rightUrl: string,
      lastComparisonId: string,
      leftLabel?: string,
      rightLabel?: string
    ): void => {
      setHistory((prev) => {
        // Remove existing entry with same URLs (to move it to front)
        const filtered = prev.filter(
          (e) => !(e.leftUrl === leftUrl && e.rightUrl === rightUrl)
        );

        // Create new entry
        const newEntry: HistoryEntry = {
          leftUrl,
          rightUrl,
          leftLabel,
          rightLabel,
          lastComparisonId,
          lastRunAt: Date.now(),
        };

        // Add to front
        const updated = [newEntry, ...filtered];

        // LRU eviction: keep only most recent MAX_ENTRIES
        const evicted = updated.slice(0, MAX_ENTRIES);

        // Persist to localStorage
        persistHistory(evicted);

        return evicted;
      });
    },
    [persistHistory]
  );

  /**
   * Retrieve all pairs from history, most recently used first (MRU).
   */
  const listPairs = useCallback((): HistoryEntry[] => {
    return history;
  }, [history]);

  /**
   * Retrieve a single pair by (leftUrl, rightUrl) key.
   * Returns null if not found.
   */
  const getPair = useCallback(
    (pairKey: PairKey): HistoryEntry | null => {
      return (
        history.find(
          (e) => e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
        ) ?? null
      );
    },
    [history]
  );

  /**
   * Retrieve a single pair by (leftUrl, rightUrl) and move it to front (LRU access).
   * Returns the entry if found, null otherwise.
   * Deterministic return value (safe for React).
   */
  const getPairAndPromote = useCallback(
    (pairKey: PairKey): HistoryEntry | null => {
      // Lookup from current state (synchronous, deterministic)
      const found =
        history.find(
          (e) =>
            e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl
        ) ?? null;

      if (!found) return null;

      // Mutation is asynchronous, but we return the value we found synchronously
      setHistory((prev) => {
        const filtered = prev.filter(
          (e) =>
            !(e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl)
        );
        const updated = [found, ...filtered];

        // Persist
        persistHistory(updated);

        return updated;
      });

      return found;
    },
    [history, persistHistory]
  );

  /**
   * Delete a pair by (leftUrl, rightUrl) key.
   */
  const deletePair = useCallback(
    (pairKey: PairKey): void => {
      setHistory((prev) => {
        const filtered = prev.filter(
          (e) =>
            !(e.leftUrl === pairKey.leftUrl && e.rightUrl === pairKey.rightUrl)
        );
        if (filtered.length === prev.length) return prev; // Not found, no change

        // Persist
        persistHistory(filtered);

        return filtered;
      });
    },
    [persistHistory]
  );

  /**
   * Clear all history.
   */
  const clearHistory = useCallback((): void => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      if (import.meta.env.DEV) {
        console.warn("[usePairHistory] Failed to clear localStorage");
      }
    }
  }, []);

  return {
    history: listPairs(),
    savePair,
    listPairs,
    getPair,
    getPairAndPromote,
    deletePair,
    clearHistory,
  };
}
