import type { FC } from "react";
import type { DiffFinding } from "@shared/diff";
import { SeverityBadge } from "./SeverityBadge";
import { EvidenceList } from "./EvidenceList";
import { ValueComparison } from "./ValueComparison";
import { RawJSON } from "./RawJSON";
import styles from "./FindingDetailView.module.css";

/**
 * FindingDetailView: Expanded detail view of a single finding.
 *
 * Shows:
 * - Finding code + category + severity (header)
 * - Message text
 * - Graceful degradation chain:
 *   1. If evidence[]: render EvidenceList
 *   2. Else if left_value || right_value: render ValueComparison
 *   3. Else: render RawJSON fallback
 * - Recommendations section (if present)
 * - Optional close button/callback
 */
export interface FindingDetailViewProps {
  finding: DiffFinding;
  onClose?: () => void;
}

export const FindingDetailView: FC<FindingDetailViewProps> = ({
  finding,
  onClose,
}) => {
  const hasEvidence = finding.evidence && finding.evidence.length > 0;
  const hasValues =
    finding.left_value !== undefined || finding.right_value !== undefined;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerContent}>
            <div className={styles.code}>{finding.code}</div>
            <div className={styles.category}>{finding.category}</div>
            <SeverityBadge severity={finding.severity} />
          </div>
          {onClose && (
            <button className={styles.closeButton} onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        <div className={styles.message}>{finding.message}</div>
      </div>

      {/* Body: Graceful degradation chain */}
      <div className={styles.body}>
        {hasEvidence ? (
          <EvidenceList evidence={finding.evidence!} />
        ) : hasValues ? (
          <ValueComparison
            left={finding.left_value}
            right={finding.right_value}
          />
        ) : (
          <RawJSON data={finding} title="Finding Data" />
        )}
      </div>

      {/* Recommendations section */}
      {finding.recommendations && finding.recommendations.length > 0 && (
        <div className={styles.recommendations}>
          <div className={styles.recommendationsTitle}>Recommendations</div>
          <ul className={styles.recommendationsList}>
            {finding.recommendations.map((rec, idx) => (
              <li key={idx} className={styles.recommendationItem}>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
