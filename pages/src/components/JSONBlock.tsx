import type { FC } from "react";
import { useState } from "react";
import { RawJSON } from "./RawJSON";
import styles from "./JSONBlock.module.css";

/**
 * JSONBlock: Collapsible JSON data block with copy button.
 *
 * Shows:
 * - Collapsible header with toggle icon (▶/▼)
 * - JSON content (when expanded)
 * - Copy button (MVP: placeholder, functional in Phase 4)
 */
export interface JSONBlockProps {
  title: string;
  data?: unknown;
}

export const JSONBlock: FC<JSONBlockProps> = ({ title, data }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (data === null || data === undefined) {
    return null;
  }

  const handleToggle = () => setIsExpanded(!isExpanded);

  const handleCopy = () => {
    const jsonString = JSON.stringify(data, null, 2);
    navigator.clipboard
      .writeText(jsonString)
      .catch(() => {
        // Silently fail on copy error (Phase 4: show toast notification)
      });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          className={styles.headerButton}
          onClick={handleToggle}
          aria-expanded={isExpanded}
        >
          <span className={styles.toggleIcon}>{isExpanded ? "▼" : "▶"}</span>
          <span className={styles.title}>{title}</span>
        </button>
        <button
          className={styles.copyButton}
          onClick={handleCopy}
          title="Copy JSON to clipboard"
        >
          Copy
        </button>
      </div>
      {isExpanded && (
        <div className={styles.content}>
          <RawJSON data={data} />
        </div>
      )}
    </div>
  );
};
