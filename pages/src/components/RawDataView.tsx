import type { FC } from "react";
import type { SignalEnvelope, EnvDiff } from "@shared/diff";
import { JSONBlock } from "./JSONBlock";
import styles from "./RawDataView.module.css";

/**
 * RawDataView: Forensic view of raw comparison data.
 *
 * Shows:
 * - Three collapsible JSON blocks: "Left Probe Data", "Right Probe Data", "Diff Output"
 * - Each block can be expanded/collapsed independently
 * - Copy button on each block (MVP: placeholder)
 * - Hides sections when data is null/undefined
 */
export interface RawDataViewProps {
  left?: SignalEnvelope;
  right?: SignalEnvelope;
  diff?: EnvDiff;
}

export const RawDataView: FC<RawDataViewProps> = ({ left, right, diff }) => {
  // Hide entire section if no data
  if (!left && !right && !diff) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.title}>Raw Data</div>
      <div className={styles.blocks}>
        {left && <JSONBlock title="Left Probe Data" data={left} />}
        {right && <JSONBlock title="Right Probe Data" data={right} />}
        {diff && <JSONBlock title="Diff Output" data={diff} />}
      </div>
    </div>
  );
};
