import type { FC } from "react";
import { useState } from "react";
import type { CompareResult } from "@shared/api";
import type { LlmExplanation } from "@shared/llm";
import { SummaryStrip } from "./SummaryStrip";
import { ExplanationPanel } from "./ExplanationPanel";
import { FindingsList } from "./FindingsList";
import { FindingDetailView } from "./FindingDetailView";
import { RawDataView } from "./RawDataView";
import styles from "./ResultDashboard.module.css";

export interface ResultDashboardProps {
  result: CompareResult;
}

/**
 * ResultDashboard: Parent container for all dashboard layers.
 *
 * Renders only when a completed comparison result is available.
 * Composes:
 *   Layer 0 — SummaryStrip (severity, findings count, status codes)
 *   Layer 1 — ExplanationPanel (LLM summary, ranked causes, actions)
 *   Layer 2 — FindingsList (categorized findings with expand/collapse)
 *   Layer 3 — FindingDetailView (expanded finding detail, conditional)
 *   Forensics — RawDataView (collapsible JSON blocks)
 *
 * expandedFindingId state is dashboard-local (not lifted to App).
 */
export const ResultDashboard: FC<ResultDashboardProps> = ({ result }) => {
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(
    null
  );

  const diff = result.diff;
  const explanation = result.explanation as LlmExplanation | undefined;
  const findings = diff?.findings ?? [];

  const handleFindingClick = (findingId: string) => {
    setExpandedFindingId((prev) => (prev === findingId ? null : findingId));
  };

  const expandedFinding = expandedFindingId
    ? findings.find((f) => f.id === expandedFindingId) ?? null
    : null;

  return (
    <div className={styles.container}>
      <SummaryStrip result={result} />

      <ExplanationPanel explanation={explanation} />

      <FindingsList
        findings={findings}
        expandedId={expandedFindingId}
        onExpandClick={handleFindingClick}
      />

      {expandedFinding && (
        <FindingDetailView
          finding={expandedFinding}
          onClose={() => setExpandedFindingId(null)}
        />
      )}

      <RawDataView left={result.left} right={result.right} diff={diff} />
    </div>
  );
};
