import type { FC } from "react";
import type { RankedCause } from "@shared/llm";
import styles from "./CauseItem.module.css";
import { ConfidenceBar } from "./ConfidenceBar";

export interface CauseItemProps {
  cause: RankedCause;
}

/**
 * CauseItem: Display a single ranked cause with confidence and evidence.
 *
 * Props:
 * - cause: RankedCause with cause text, confidence, and evidence array
 *
 * Displays:
 * - Cause text
 * - Confidence bar (0–100%)
 * - Evidence bullet list
 */
export const CauseItem: FC<CauseItemProps> = ({ cause }) => {
  const hasEvidence = cause.evidence && cause.evidence.length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h4 className={styles.cause}>{cause.cause}</h4>
        <div className={styles.confidenceWrapper}>
          <span className={styles.confidenceLabel}>Confidence:</span>
          <ConfidenceBar confidence={cause.confidence} />
        </div>

        {hasEvidence && (
          <div className={styles.evidence}>
            <p className={styles.evidenceLabel}>Evidence:</p>
            <ul className={styles.evidenceList}>
              {cause.evidence.map((item, idx) => (
                <li key={idx} className={styles.evidenceItem}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
