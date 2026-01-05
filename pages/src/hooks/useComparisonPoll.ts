import { useEffect, useRef, useState } from "react";
import type { CompareStatusResponse } from "../../../shared/api";
import { getCompareStatus } from "../lib/api";

type PollState<ResultT> = {
  status: "idle" | "running" | "completed" | "failed";
  result: ResultT | null;
  error: string | null;
};

export function useComparisonPoll<ResultT = unknown>(
  comparisonId: string | null,
  intervalMs = 1200,
  maxAttempts = 200
) {
  const [state, setState] = useState<PollState<ResultT>>({
    status: "idle",
    result: null,
    error: null,
  });

  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!comparisonId) {
      setState({ status: "idle", result: null, error: null });
      attemptsRef.current = 0;
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    setState({ status: "running", result: null, error: null });
    attemptsRef.current = 0;

    const tick = async () => {
      if (cancelled) return;

      attemptsRef.current += 1;
      if (attemptsRef.current > maxAttempts) {
        setState({
          status: "failed",
          result: null,
          error: "Timed out waiting for comparison result.",
        });
        return;
      }

      try {
        const resp: CompareStatusResponse<ResultT> =
          await getCompareStatus<ResultT>(comparisonId);

        if (resp.status === "running") {
          setState((s) => ({ ...s, status: "running" }));
        } else if (resp.status === "failed") {
          setState({
            status: "failed",
            result: null,
            error: resp.error ?? "Comparison failed.",
          });
          return;
        } else {
          setState({
            status: "completed",
            result: (resp.result ?? null) as ResultT | null,
            error: null,
          });
          return;
        }
      } catch (e: any) {
        setState({
          status: "failed",
          result: null,
          error: e?.message ?? "Request failed.",
        });
        return;
      }

      timer = window.setTimeout(tick, intervalMs);
    };

    timer = window.setTimeout(tick, 0);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [comparisonId, intervalMs, maxAttempts]);

  return state;
}
