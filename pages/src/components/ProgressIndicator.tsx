import type { FC } from "react";
import styles from "./ProgressIndicator.module.css";

/**
 * ProgressIndicator: Visual feedback during polling.
 *
 * Features:
 * - CSS-only spinner animation (no libraries)
 * - Heuristic progress message (updated every 100ms)
 * - Elapsed time display with precision (e.g., "5.2s")
 * - Hide when status !== "running"
 *
 * Props:
 * - status: Current comparison status ("idle", "running", "completed", "failed")
 * - progress?: Heuristic message (e.g., "Probing environments…")
 * - elapsedMs?: Elapsed milliseconds since poll start
 */
export interface ProgressIndicatorProps {
  status: "idle" | "running" | "completed" | "failed";
  progress?: string;
  elapsedMs?: number;
}

export const ProgressIndicator: FC<ProgressIndicatorProps> = ({
  status,
  progress,
  elapsedMs,
}) => {
  // Only render during polling
  if (status !== "running") {
    return null;
  }

  // Format elapsed time: ms to "X.Xs" format
  const formatElapsed = (ms: number): string => {
    const seconds = ms / 1000;
    return seconds.toFixed(1) + "s";
  };

  return (
    <div className={styles.container}>
      <div className={styles.spinnerWrapper}>
        <div className={styles.spinner} />
      </div>
      <div className={styles.content}>
        {progress && <div className={styles.message}>{progress}</div>}
        {elapsedMs !== undefined && (
          <div className={styles.elapsed}>{formatElapsed(elapsedMs)}</div>
        )}
      </div>
    </div>
  );
};
