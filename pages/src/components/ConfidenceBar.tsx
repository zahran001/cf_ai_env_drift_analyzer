import type { FC } from "react";
import styles from "./ConfidenceBar.module.css";

export interface ConfidenceBarProps {
  confidence: number;
}

/**
 * ConfidenceBar: Visual indicator of confidence level (0–100%).
 *
 * Props:
 * - confidence: Number in range [0, 1] (e.g., 0.85 = 85%)
 *
 * Displays:
 * - Visual bar from 0–100%
 * - Percentage text (e.g., "85%")
 */
export const ConfidenceBar: FC<ConfidenceBarProps> = ({ confidence }) => {
  const clampedConfidence = Math.max(0, Math.min(1, confidence));
  const percentage = Math.round(clampedConfidence * 100);

  return (
    <div className={styles.container}>
      <div className={styles.barBackground}>
        <div
          className={styles.barFill}
          style={{ width: `${clampedConfidence * 100}%` }}
        />
      </div>
      <div className={styles.percentage}>{percentage}%</div>
    </div>
  );
};
