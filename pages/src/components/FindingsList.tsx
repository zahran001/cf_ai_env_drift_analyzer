import type { FC } from "react";
import type { DiffFinding, FindingCategory, Severity } from "@shared/diff";
import styles from "./FindingsList.module.css";
import { CategoryGroup } from "./CategoryGroup";

export interface FindingsListProps {
  findings: DiffFinding[];
  expandedId?: string | null;
  onExpandClick?: (findingId: string) => void;
}

/**
 * FindingsList: Categorized, sortable list of findings (Dashboard Layer 2).
 *
 * Groups findings by category dynamically (7 categories: routing, security, cache, content, timing, platform, unknown).
 * Within each category, sorts by severity (critical → warn → info).
 *
 * Features:
 * - Dynamic category grouping
 * - Severity-based sorting within categories
 * - Expandable rows (click to expand finding detail)
 * - "No differences found" message when empty
 *
 * Note: Each finding can be expanded/collapsed via onExpandClick callback.
 * Toggle behavior is wired at parent level (App.tsx).
 */
export const FindingsList: FC<FindingsListProps> = ({
  findings,
  expandedId,
  onExpandClick,
}) => {
  // Group findings by category
  const categories: FindingCategory[] = [
    "routing",
    "security",
    "cache",
    "content",
    "timing",
    "platform",
    "unknown",
  ];

  // Build map of category → findings
  const findingsByCategory = new Map<FindingCategory, DiffFinding[]>();
  for (const category of categories) {
    findingsByCategory.set(category, []);
  }

  for (const finding of findings) {
    const cat = findingsByCategory.get(finding.category) || [];
    cat.push(finding);
    findingsByCategory.set(finding.category, cat);
  }

  // Sort findings within each category by severity
  const categoryGroups: Array<{ category: FindingCategory; findings: DiffFinding[] }> = [];
  for (const category of categories) {
    const catFindings = findingsByCategory.get(category) ?? [];
    if (catFindings.length > 0) {
      // Sort by severity (critical → warn → info)
      const sorted = [...catFindings].sort((a, b) => {
        const severityOrder: Record<Severity, number> = {
          critical: 0,
          warn: 1,
          info: 2,
        };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });
      categoryGroups.push({ category, findings: sorted });
    }
  }


  if (findings.length === 0) {
    return (
      <div className={styles.noFindings}>
        <div className={styles.noFindingsIcon}>✓</div>
        <div className={styles.noFindingsText}>No differences found</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Findings</h2>
      </div>

      <div className={styles.groups}>
        {categoryGroups.map(({ category, findings: catFindings }) => (
          <CategoryGroup
            key={category}
            category={category}
            findings={catFindings}
            expandedId={expandedId}
            onExpandClick={onExpandClick}
          />
        ))}
      </div>
    </div>
  );
};
