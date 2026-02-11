import { useEffect, useRef, useState } from "react";
import type { CompareStatusResponse, CompareError } from "@shared/api";
import { getCompareStatus } from "../lib/api";
import { getHeuristicProgress } from "../lib/heuristic";

type PollState<ResultT> = {
  status: "idle" | "running" | "completed" | "failed";
  result: ResultT | null;
  error: CompareError | null;
  progress?: string;
  elapsedMs?: number;
};

export function useComparisonPoll<ResultT = unknown>(
  comparisonId: string | null,
  intervalMs?: number | number[],
  maxAttempts = 200
) {
  const [state, setState] = useState<PollState<ResultT>>({
    status: "idle",
    result: null,
    error: null,
  });

  const attemptsRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const backoffArrayRef = useRef<number[]>([]);

  // Normalize intervalMs to backoff array
  useEffect(() => {
    if (Array.isArray(intervalMs)) {
      backoffArrayRef.current = intervalMs;
    } else {
      backoffArrayRef.current = [intervalMs ?? 1200];
    }
  }, [intervalMs]);

  useEffect(() => {
    if (!comparisonId) {
      setState({ status: "idle", result: null, error: null });
      attemptsRef.current = 0;
      startTimeRef.current = null;
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let progressTimer: number | undefined;

    setState({ status: "running", result: null, error: null });
    attemptsRef.current = 0;
    startTimeRef.current = Date.now();

    // Update progress every 100ms
    const updateProgress = () => {
      if (!cancelled && startTimeRef.current) {
        const elapsedMs = Date.now() - startTimeRef.current;
        const progress = getHeuristicProgress(elapsedMs);
        setState((s) => ({
          ...s,
          progress,
          elapsedMs,
        }));
      }
      if (!cancelled) {
        progressTimer = window.setTimeout(updateProgress, 100);
      }
    };
    progressTimer = window.setTimeout(updateProgress, 100);

    const tick = async () => {
      if (cancelled) return;

      attemptsRef.current += 1;
      if (attemptsRef.current > maxAttempts) {
        setState({
          status: "failed",
          result: null,
          error: {
            code: "timeout",
            message: "Timed out waiting for comparison result.",
          },
        });
        return;
      }

      try {
        const resp: CompareStatusResponse<ResultT> =
          await getCompareStatus<ResultT>(comparisonId);

        // Treat "queued" as "running" for UX purposes; heuristic progress messaging covers the queuing phase
        if (resp.status === "running" || resp.status === "queued") {
          setState((s) => ({ ...s, status: "running" }));
        } else if (resp.status === "failed") {
          setState({
            status: "failed",
            result: null,
            error: resp.error ?? { code: "internal_error", message: "Comparison failed." },
          });
          return;
        } else if (resp.status === "completed") {
          setState({
            status: "completed",
            result: (resp.result ?? null) as ResultT | null,
            error: null,
            progress: undefined,
            elapsedMs: startTimeRef.current ? Date.now() - startTimeRef.current : undefined,
          });
          return;
        }
      } catch (e: unknown) {
        // 404 is transient during early polls — the Workflow may not have
        // created the DO record yet. Keep polling instead of failing.
        const isNotFound =
          e instanceof Error && "status" in e && (e as { status: number }).status === 404;
        if (isNotFound && attemptsRef.current <= 10) {
          // Fall through to schedule next poll
        } else {
          const message = e instanceof Error ? e.message : "Request failed.";
          setState({
            status: "failed",
            result: null,
            error: {
              code: "internal_error",
              message,
            },
          });
          return;
        }
      }

      // Get next interval from backoff array (or repeat last)
      const nextIntervalMs =
        backoffArrayRef.current[Math.min(attemptsRef.current - 1, backoffArrayRef.current.length - 1)] ||
        backoffArrayRef.current[backoffArrayRef.current.length - 1];
      timer = window.setTimeout(tick, nextIntervalMs);
    };

    timer = window.setTimeout(tick, 0);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (progressTimer) window.clearTimeout(progressTimer);
    };
  }, [comparisonId, maxAttempts]);

  return state;
}
