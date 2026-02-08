import { useState } from "react";
import type { CompareRequest, CompareResult, CompareError } from "@shared/api";
import { startCompare, ApiError } from "./lib/api";
import { useComparisonPoll } from "./hooks/useComparisonPoll";
import { usePairHistory } from "./hooks/usePairHistory";
import { ControlPlane } from "./components/ControlPlane";
import { ProgressIndicator } from "./components/ProgressIndicator";
import { ErrorBanner } from "./components/ErrorBanner";
import { ResultDashboard } from "./components/ResultDashboard";
import styles from "./App.module.css";

export default function App() {
  // Form state (lifted for ControlPlane controlled component)
  const [leftUrl, setLeftUrl] = useState("");
  const [rightUrl, setRightUrl] = useState("");
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");

  // Comparison state
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  // Submit-time error (before polling starts)
  const [submitError, setSubmitError] = useState<CompareError | null>(null);

  // Polling with exponential backoff: 500ms, 1000ms, 2000ms
  const poll = useComparisonPoll<CompareResult>(comparisonId, [500, 1000, 2000]);
  const { history } = usePairHistory();

  async function handleCompareSubmit(req: CompareRequest) {
    setSubmitError(null);
    setComparisonId(null);
    try {
      const response = await startCompare(req);
      setComparisonId(response.comparisonId);
    } catch (err) {
      // Extract CompareError from ApiError if available
      if (err instanceof ApiError && err.compareError) {
        setSubmitError(err.compareError);
      } else {
        setSubmitError({
          code: "internal_error",
          message: err instanceof Error ? err.message : "Failed to start comparison",
        });
      }
    }
  }

  function handleDismissError() {
    setSubmitError(null);
    setComparisonId(null);
  }

  function handleHistoryClick(entry: {
    leftUrl: string;
    rightUrl: string;
    leftLabel?: string;
    rightLabel?: string;
  }) {
    setLeftUrl(entry.leftUrl);
    setRightUrl(entry.rightUrl);
    setLeftLabel(entry.leftLabel ?? "");
    setRightLabel(entry.rightLabel ?? "");
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>cf_ai_env_drift_analyzer</h1>
      <p className={styles.subtitle}>
        Compare two environments and get an explanation for drift.
      </p>

      <ErrorBanner error={submitError ?? poll.error} onDismiss={handleDismissError} />

      <ControlPlane
        leftUrl={leftUrl}
        rightUrl={rightUrl}
        leftLabel={leftLabel}
        rightLabel={rightLabel}
        onLeftUrlChange={setLeftUrl}
        onRightUrlChange={setRightUrl}
        onLeftLabelChange={setLeftLabel}
        onRightLabelChange={setRightLabel}
        onSubmit={handleCompareSubmit}
        isLoading={poll.status === "running"}
      />

      <ProgressIndicator
        status={poll.status}
        progress={poll.progress}
        elapsedMs={poll.elapsedMs}
      />

      {history.length > 0 && (
        <div className={styles.historySection}>
          <div className={styles.historyTitle}>Recent pairs:</div>
          <div className={styles.historyGrid}>
            {history.slice(0, 5).map((entry, i) => (
              <button
                key={i}
                className={styles.historyButton}
                onClick={() => handleHistoryClick(entry)}
              >
                {entry.leftLabel || entry.leftUrl} →{" "}
                {entry.rightLabel || entry.rightUrl}
              </button>
            ))}
          </div>
        </div>
      )}

      {poll.status === "completed" && poll.result && (
        <div className={styles.resultSection}>
          <ResultDashboard result={poll.result} />
        </div>
      )}
    </div>
  );
}
