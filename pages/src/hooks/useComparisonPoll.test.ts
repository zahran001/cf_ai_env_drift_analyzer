import { renderHook, waitFor, act } from "@testing-library/react";
import { useComparisonPoll } from "./useComparisonPoll";
import type { CompareError } from "@shared/api";

// Mock the API module to avoid import.meta issues in Jest
jest.mock("../lib/api", () => ({
  getCompareStatus: jest.fn(),
}));

import * as api from "../lib/api";

const mockGetCompareStatus = jest.mocked(api.getCompareStatus);

describe("useComparisonPoll", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    try {
      act(() => {
        jest.advanceTimersByTime(10000);
      });
    } catch {
      // Ignore errors during cleanup
    }
    jest.useRealTimers();
  });

  test("starts in idle state when no comparisonId", () => {
    const { result } = renderHook(() => useComparisonPoll(null));

    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("transitions to running when comparisonId is set", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useComparisonPoll(id),
      { initialProps: { id: null as string | null } }
    );

    expect(result.current.status).toBe("idle");

    rerender({ id: "cmp-123" as string | null });
    expect(result.current.status).toBe("running");
  });

  test("transitions to completed with result", async () => {
    const expectedResult = { diff: { findings: [] }, explanation: null };
    mockGetCompareStatus.mockResolvedValue({
      status: "completed",
      result: expectedResult,
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123"));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("completed");
    });

    expect(result.current.result).toEqual(expectedResult);
    expect(result.current.error).toBeNull();
  });

  test("transitions to failed with CompareError", async () => {
    const error: CompareError = { code: "timeout" as const, message: "Request timed out" };
    mockGetCompareStatus.mockResolvedValue({
      status: "failed",
      error,
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123"));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.result).toBeNull();
  });

  test("treats queued status as running", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "queued",
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123"));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });
  });

  test("supports backoff array [500, 1000, 2000]", async () => {
    mockGetCompareStatus
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({
        status: "completed",
        result: { data: "ok" },
      });

    renderHook(() =>
      useComparisonPoll("cmp-123", [500, 1000, 2000])
    );

    // Initial call (immediate)
    act(() => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
    });

    // Second call after 500ms backoff
    act(() => {
      jest.advanceTimersByTime(500);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(2);
    });

    // Third call after 1000ms backoff
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(3);
    });
  });

  test("repeats last backoff interval after array exhausted", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    renderHook(() =>
      useComparisonPoll("cmp-123", [500, 1000], 5)
    );

    // First call (immediate)
    act(() => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
    });

    // Second call after 500ms
    act(() => {
      jest.advanceTimersByTime(500);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(2);
    });

    // Third call after 1000ms (first backoff exhaustion)
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(3);
    });

    // Fourth call after 1000ms (repeats last)
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(4);
    });

    // Fifth call after 1000ms (repeats last)
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(5);
    });
  });

  test("supports single interval number", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    renderHook(() => useComparisonPoll("cmp-123", 1000, 3));

    // Initial call
    act(() => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
    });

    // Second call after 1000ms
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(2);
    });

    // Third call after 1000ms
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(3);
    });
  });

  test("respects maxAttempts limit", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { result } = renderHook(() =>
      useComparisonPoll("cmp-123", 100, 2)
    );

    act(() => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });
    await waitFor(() => {
      expect(mockGetCompareStatus).toHaveBeenCalledTimes(2);
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });
    // Should fail on third attempt
    await waitFor(() => {
      expect(result.current.status).toBe("failed");
      expect(result.current.error?.code).toBe("timeout");
    });
  });

  test("tracks elapsed time during polling", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123", 500));

    act(() => {
      jest.advanceTimersByTime(0);
    });
    // Progress timer updates every 100ms
    act(() => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(100);
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(300);
    });
  });

  test("provides heuristic progress messages", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123", 500));

    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(result.current.progress).toBe("Initializing comparison…");
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(result.current.progress).toBe("Probing environments…");
    });

    act(() => {
      jest.advanceTimersByTime(3500);
    });

    await waitFor(() => {
      expect(result.current.progress).toBe(
        "Analyzing drift & generating explanation…"
      );
    });
  });

  test("clears progress on completion", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "completed",
      result: { data: "ok" },
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123", 500));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("completed");
      expect(result.current.progress).toBeUndefined();
    });
  });

  test("handles network errors gracefully", async () => {
    mockGetCompareStatus.mockRejectedValue(new Error("Network failed"));

    const { result } = renderHook(() => useComparisonPoll("cmp-123", 100));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
      expect(result.current.error?.code).toBe("internal_error");
      expect(result.current.error?.message).toContain("Network failed");
    });
  });

  test("cleanup on unmount cancels pending timers", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { unmount } = renderHook(() => useComparisonPoll("cmp-123", 500));

    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);

    unmount();

    act(() => {
      jest.advanceTimersByTime(500);
    });
    // Should not call API again after unmount
    expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
  });

  test("cleanup on comparisonId change cancels polling", async () => {
    mockGetCompareStatus.mockResolvedValue({
      status: "running",
    });

    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useComparisonPoll(id),
      { initialProps: { id: "cmp-123" as string | null } }
    );

    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);

    rerender({ id: null as string | null });

    act(() => {
      jest.advanceTimersByTime(500);
    });
    // Should not call API after changing to null
    expect(mockGetCompareStatus).toHaveBeenCalledTimes(1);
  });

  test("returns typed CompareError (not string)", async () => {
    const error: CompareError = { code: "dns_error" as const, message: "DNS lookup failed" };
    mockGetCompareStatus.mockResolvedValue({
      status: "failed",
      error,
    });

    const { result } = renderHook(() => useComparisonPoll("cmp-123", 100));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
      expect(result.current.error).toEqual(error);
      expect(typeof result.current.error?.code).toBe("string");
    });
  });
});
