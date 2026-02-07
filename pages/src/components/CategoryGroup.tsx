import type { FC } from "react";
import { useState } from "react";
import type { DiffFinding, FindingCategory } from "@shared/diff";
import styles from "./CategoryGroup.module.css";
import { FindingItem } from "./FindingItem";

export interface CategoryGroupProps {
  category: FindingCategory;
  findings: DiffFinding[];
  expandedId?: string | null;
  onExpandClick?: (findingId: string) => void;
}

/**
 * CategoryGroup: Collapsible section for a category of findings.
 *
 * Shows:
 * - Category name as header
 * - Findings count (e.g., "3 findings")
 * - Collapsible icon (arrow down/up)
 * - List of FindingItem rows
 *
 * ⚠️ STATE RESET BEHAVIOR:
 * - Local isOpen state uses useState(true)
 * - If parent remounts this component (key changes), isOpen resets to true
 * - This is acceptable for MVP; Phase 4+ may lift state to parent if needed
 *
 * FUTURE IMPROVEMENT (Phase 4):
 * - To persist category collapse state across re-renders, move isOpen to:
 *   - Parent component (App.tsx) via expandedCategories state
 *   - Or localStorage via useCategoryState hook
 * - Not critical for Phase 3E (keys are stable: keyed by category)
 */
export const CategoryGroup: FC<CategoryGroupProps> = ({
  category,
  findings,
  expandedId,
  onExpandClick,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const getCategoryLabel = (): string => {
    switch (category) {
      case "routing":
        return "Routing";
      case "security":
        return "Security";
      case "cache":
        return "Cache";
      case "content":
        return "Content";
      case "timing":
        return "Timing";
      case "platform":
        return "Platform";
      case "unknown":
        return "Unknown";
      default:
        return "Unknown";
    }
  };

  const getCategoryColor = (): string => {
    switch (category) {
      case "routing":
        return styles.routingHeader;
      case "security":
        return styles.securityHeader;
      case "cache":
        return styles.cacheHeader;
      case "content":
        return styles.contentHeader;
      case "timing":
        return styles.timingHeader;
      case "platform":
        return styles.platformHeader;
      case "unknown":
        return styles.unknownHeader;
      default:
        return styles.unknownHeader;
    }
  };

  return (
    <div className={styles.group}>
      <button className={`${styles.header} ${getCategoryColor()}`} onClick={handleToggle}>
        <span className={styles.arrow}>{isOpen ? "▼" : "▶"}</span>
        <span className={styles.categoryName}>{getCategoryLabel()}</span>
        <span className={styles.count}>{findings.length}</span>
      </button>

      {isOpen && (
        <div className={styles.items}>
          {findings.map((finding) => (
            <FindingItem
              key={finding.id}
              finding={finding}
              isExpanded={expandedId === finding.id}
              onClick={() => onExpandClick?.(finding.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
