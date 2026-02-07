import type { FC } from "react";
import { RawJSON } from "./RawJSON";
import styles from "./ValueComparison.module.css";

/**
 * ValueComparison: Display left/right values side-by-side (or stacked on mobile).
 *
 * Shows:
 * - Left value (formatted as JSON)
 * - Right value (formatted as JSON)
 * - Graceful handling of undefined values (shows "—")
 * - Responsive: stacked on mobile, side-by-side on tablet+
 */
export interface ValueComparisonProps {
  left?: unknown;
  right?: unknown;
}

export const ValueComparison: FC<ValueComparisonProps> = ({ left, right }) => {
  const hasLeft = left !== undefined;
  const hasRight = right !== undefined;

  if (!hasLeft && !hasRight) {
    return (
      <div className={styles.empty}>
        <p>No values available for comparison</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.column}>
        <div className={styles.header}>Left</div>
        {hasLeft ? (
          <RawJSON data={left} />
        ) : (
          <div className={styles.placeholder}>—</div>
        )}
      </div>
      <div className={styles.column}>
        <div className={styles.header}>Right</div>
        {hasRight ? (
          <RawJSON data={right} />
        ) : (
          <div className={styles.placeholder}>—</div>
        )}
      </div>
    </div>
  );
};
