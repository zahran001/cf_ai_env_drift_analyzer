import type { FC } from "react";
import type { RecommendedAction } from "@shared/llm";
import styles from "./ActionItem.module.css";

export interface ActionItemProps {
  action: RecommendedAction;
}

/**
 * ActionItem: Display a single recommended action with reasoning.
 *
 * Props:
 * - action: RecommendedAction with action text and why reasoning
 *
 * Displays:
 * - Action text (main recommendation)
 * - Why reasoning (grounded in diff)
 */
export const ActionItem: FC<ActionItemProps> = ({ action }) => {
  return (
    <div className={styles.container}>
      <div className={styles.actionText}>{action.action}</div>
      <div className={styles.why}>{action.why}</div>
    </div>
  );
};
