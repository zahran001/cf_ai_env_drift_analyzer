import type { FC } from "react";
import type { CompareResult } from "@shared/api";
import type { EnvDiff, Severity } from "@shared/diff";
import type { SignalEnvelope } from "@shared/signal";
import { computeMaxSeverity } from "@shared/diff";
import styles from "./SummaryStrip.module.css";
import { SeverityBadge } from "./SeverityBadge";
import { StatusCodeBadge } from "./StatusCodeBadge";

export interface SummaryStripProps {
  result: CompareResult;
  onFindingClick?: (findingId: string) => void;
}

/**
 * SummaryStrip: High-level overview of comparison results (Dashboard Layer 0).
 *
 * Displays:
 * - Max severity badge (critical/warn/info with emoji)
 * - Findings count
 * - Left status code + duration
 * - Right status code + duration
 *
 * Type Casting Rule: Always extract findings from result.diff?.findings, not result.findings
 */
export const SummaryStrip: FC<SummaryStripProps> = ({ result }) => {
  // Safe casting: diff may be undefined
  const diff = result.diff as EnvDiff | undefined;
  const findings = diff?.findings ?? [];
  const maxSeverity = diff ? computeMaxSeverity(findings) : ("info" as Severity);

  // Extract status codes from diff (safe with optional chaining)
  const leftStatus = diff?.status?.left;
  const rightStatus = diff?.status?.right;
  const leftDuration = diff ? extractDurationMs(result.left as SignalEnvelope | undefined) : undefined;
  const rightDuration = diff ? extractDurationMs(result.right as SignalEnvelope | undefined) : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <SeverityBadge severity={maxSeverity} />
        <div className={styles.findingsCount}>
          {findings.length} {findings.length === 1 ? "Finding" : "Findings"}
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.statusSection}>
        <div className={styles.statusLabel}>Left</div>
        {leftStatus !== undefined && leftDuration !== undefined ? (
          <StatusCodeBadge status={leftStatus} durationMs={leftDuration} />
        ) : (
          <div className={styles.noData}>—</div>
        )}
      </div>

      <div className={styles.statusSection}>
        <div className={styles.statusLabel}>Right</div>
        {rightStatus !== undefined && rightDuration !== undefined ? (
          <StatusCodeBadge status={rightStatus} durationMs={rightDuration} />
        ) : (
          <div className={styles.noData}>—</div>
        )}
      </div>
    </div>
  );
};

/**
 * Helper: Extract durationMs from a SignalEnvelope
 */
function extractDurationMs(envelope: SignalEnvelope | undefined): number | undefined {
  if (!envelope) return undefined;
  if (envelope.result.ok === true) return envelope.result.durationMs;
  if (envelope.result.ok === false) return envelope.result.durationMs;
  return undefined;
}
