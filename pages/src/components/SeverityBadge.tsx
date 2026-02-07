import type { FC } from "react";
import type { Severity } from "@shared/diff";
import styles from "./SeverityBadge.module.css";

export interface SeverityBadgeProps {
  severity: Severity;
}

/**
 * SeverityBadge: Visual indicator for finding severity.
 *
 * - Critical (🔴) → Red (#dc2626)
 * - Warn (🟠) → Amber (#f59e0b)
 * - Info (🔵) → Blue (#3b82f6)
 */
export const SeverityBadge: FC<SeverityBadgeProps> = ({ severity }) => {
  const getSeverityText = () => {
    switch (severity) {
      case "critical":
        return "🔴 Critical";
      case "warn":
        return "🟠 Warning";
      case "info":
        return "🔵 Info";
      default:
        return "🔵 Info";
    }
  };

  const getBadgeClassName = () => {
    switch (severity) {
      case "critical":
        return `${styles.badge} ${styles.badgeCritical}`;
      case "warn":
        return `${styles.badge} ${styles.badgeWarn}`;
      case "info":
        return `${styles.badge} ${styles.badgeInfo}`;
      default:
        return `${styles.badge} ${styles.badgeInfo}`;
    }
  };

  return <div className={getBadgeClassName()}>{getSeverityText()}</div>;
};
