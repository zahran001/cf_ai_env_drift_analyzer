import type { FC } from "react";
import type { DiffEvidence } from "@shared/diff";
import styles from "./EvidenceList.module.css";

/**
 * EvidenceList: Display structured evidence items as a bullet list.
 *
 * Shows:
 * - Section name (bold)
 * - Keys (if present)
 * - Note (if present, italicized)
 * - Example: "headers: cache-control, vary (value changed)"
 */
export interface EvidenceListProps {
  evidence: DiffEvidence[];
}

export const EvidenceList: FC<EvidenceListProps> = ({ evidence }) => {
  if (!evidence || evidence.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No evidence available</p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {evidence.map((item, idx) => (
        <li key={idx} className={styles.item}>
          <span className={styles.section}>{item.section}</span>
          {item.keys && item.keys.length > 0 && (
            <>
              <span className={styles.separator}>:</span>
              <span className={styles.keys}>{item.keys.join(", ")}</span>
            </>
          )}
          {item.note && (
            <span className={styles.note}> ({item.note})</span>
          )}
        </li>
      ))}
    </ul>
  );
};
