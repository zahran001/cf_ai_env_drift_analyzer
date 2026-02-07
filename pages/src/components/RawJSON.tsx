import type { FC } from "react";
import styles from "./RawJSON.module.css";

/**
 * RawJSON: Display any data as pretty-printed JSON.
 *
 * Shows:
 * - Optional title header
 * - Data formatted as JSON (2-space indent)
 * - Monospace font with word-break for readability
 */
export interface RawJSONProps {
  data: unknown;
  title?: string;
}

export const RawJSON: FC<RawJSONProps> = ({ data, title }) => {
  const jsonString = JSON.stringify(data, null, 2);

  return (
    <div className={styles.container}>
      {title && <div className={styles.title}>{title}</div>}
      <pre className={styles.pre}>
        <code className={styles.code}>{jsonString}</code>
      </pre>
    </div>
  );
};
