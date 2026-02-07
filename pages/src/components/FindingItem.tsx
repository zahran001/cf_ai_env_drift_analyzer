import type { FC } from "react";
import type { DiffFinding } from "@shared/diff";
import styles from "./FindingItem.module.css";
import { SeverityBadge } from "./SeverityBadge";

export interface FindingItemProps {
  finding: DiffFinding;
  isExpanded: boolean;
  onClick: () => void;
}

/**
 * FindingItem: Single finding row with severity badge, code, message, and expand arrow.
 *
 * Shows:
 * - Severity badge (🔴/🟠/🔵)
 * - Finding code (e.g., "STATUS_MISMATCH")
 * - Message text
 * - Expand arrow (chevron down/up)
 */
export const FindingItem: FC<FindingItemProps> = ({ finding, isExpanded, onClick }) => {
  return (
    <button className={`${styles.row} ${isExpanded ? styles.rowExpanded : ""}`} onClick={onClick}>
      <div className={styles.icon}>
        <SeverityBadge severity={finding.severity} />
      </div>

      <div className={styles.content}>
        <div className={styles.code}>{finding.code}</div>
        <div className={styles.message}>{finding.message}</div>
      </div>

      <div className={styles.arrow}>{isExpanded ? "▼" : "▶"}</div>
    </button>
  );
};
