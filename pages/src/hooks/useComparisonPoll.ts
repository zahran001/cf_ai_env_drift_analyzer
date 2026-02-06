import { useEffect, useRef, useState } from "react";
import type { CompareStatusResponse, CompareError } from "@shared/api";
import { getCompareStatus } from "../lib/api";

type PollState<ResultT> = {
  status: "idle" | "running" | "completed" | "failed";
  result: ResultT | null;
  error: CompareError | null;
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
          });
          return;
        }
      } catch (e: any) {
        setState({
          status: "failed",
          result: null,
          error: {
            code: "internal_error",
            message: e?.message ?? "Request failed.",
          },
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
