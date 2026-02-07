import type { FC } from "react";
import { useState } from "react";
import type { LlmExplanation } from "@shared/llm";
import styles from "./ExplanationPanel.module.css";
import { CauseItem } from "./CauseItem";
import { ActionItem } from "./ActionItem";

export interface ExplanationPanelProps {
  explanation?: LlmExplanation | null;
}

/**
 * ExplanationPanel: Display LLM-generated explanation (Dashboard Layer 1).
 *
 * Props:
 * - explanation: Optional LlmExplanation (null = show "unavailable")
 *
 * Features:
 * - Summary text
 * - Ranked causes section (collapsible) with confidence bars
 * - Recommended actions section (collapsible)
 * - Graceful degradation if explanation is null
 * - Expand/collapse all button
 */
export const ExplanationPanel: FC<ExplanationPanelProps> = ({ explanation }) => {
  const [expandedCauses, setExpandedCauses] = useState(false);
  const [expandedActions, setExpandedActions] = useState(false);

  if (!explanation) {
    return (
      <div className={styles.container}>
        <div className={styles.unavailable}>
          <p>Explanation unavailable</p>
          <p className={styles.unavailableDetail}>
            Showing deterministic findings only.
          </p>
        </div>
      </div>
    );
  }

  const hasCauses = explanation.ranked_causes && explanation.ranked_causes.length > 0;
  const hasActions = explanation.actions && explanation.actions.length > 0;

  return (
    <div className={styles.container}>
      {/* Summary */}
      <div className={styles.summary}>
        <h3 className={styles.summaryTitle}>Summary</h3>
        <p className={styles.summaryText}>{explanation.summary}</p>
      </div>

      {/* Ranked Causes Section */}
      {hasCauses && (
        <div className={styles.section}>
          <button
            className={styles.sectionHeader}
            onClick={() => setExpandedCauses(!expandedCauses)}
            aria-expanded={expandedCauses}
          >
            <h3 className={styles.sectionTitle}>
              Ranked Causes ({explanation.ranked_causes.length})
            </h3>
            <span className={styles.toggleIcon}>
              {expandedCauses ? "▼" : "▶"}
            </span>
          </button>

          {expandedCauses && (
            <div className={styles.sectionContent}>
              {explanation.ranked_causes.map((cause, idx) => (
                <CauseItem key={idx} cause={cause} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommended Actions Section */}
      {hasActions ? (
        <div className={styles.section}>
          <button
            className={styles.sectionHeader}
            onClick={() => setExpandedActions(!expandedActions)}
            aria-expanded={expandedActions}
          >
            <h3 className={styles.sectionTitle}>
              Recommended Actions ({explanation.actions.length})
            </h3>
            <span className={styles.toggleIcon}>
              {expandedActions ? "▼" : "▶"}
            </span>
          </button>

          {expandedActions && (
            <div className={styles.sectionContent}>
              {explanation.actions.length > 0 ? (
                explanation.actions.map((action, idx) => (
                  <ActionItem key={idx} action={action} />
                ))
              ) : (
                <div className={styles.noData}>No recommendations at this time.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.section}>
          <div className={styles.noActions}>
            <h3 className={styles.sectionTitle}>Recommended Actions</h3>
            <p className={styles.noData}>No recommendations at this time.</p>
          </div>
        </div>
      )}

      {/* Notes Section (if present) */}
      {explanation.notes && explanation.notes.length > 0 && (
        <div className={styles.notes}>
          <p className={styles.notesTitle}>Notes</p>
          <ul className={styles.notesList}>
            {explanation.notes.map((note, idx) => (
              <li key={idx} className={styles.notesItem}>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
