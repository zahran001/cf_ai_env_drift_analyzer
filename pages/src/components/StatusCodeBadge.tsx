import type { FC } from "react";
import styles from "./StatusCodeBadge.module.css";

export interface StatusCodeBadgeProps {
  status: number;
  durationMs: number;
}

/**
 * StatusCodeBadge: Displays HTTP status code + duration in compact format.
 *
 * Format: "200 (42ms)"
 */
export const StatusCodeBadge: FC<StatusCodeBadgeProps> = ({ status, durationMs }) => {
  const formatDuration = (ms: number): string => {
    return `${ms}ms`;
  };

  return (
    <div className={styles.badge}>
      <span className={styles.status}>{status}</span>
      <span className={styles.duration}>({formatDuration(durationMs)})</span>
    </div>
  );
};
