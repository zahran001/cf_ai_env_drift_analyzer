import type { FC } from "react";
import type { CompareError } from "@shared/api";
import { getErrorGuidance } from "../lib/errorMapping";
import styles from "./ErrorBanner.module.css";

export interface ErrorBannerProps {
  error?: CompareError | null;
  onDismiss?: () => void;
}

export const ErrorBanner: FC<ErrorBannerProps> = ({ error, onDismiss }) => {
  const guidance = getErrorGuidance(error);
  if (!guidance) return null;

  return (
    <div className={styles.container} role="alert">
      <div className={styles.content}>
        <div className={styles.title}>{guidance.title}</div>
        <div className={styles.guidance}>{guidance.guidance}</div>
        {error?.message && (
          <div className={styles.detail}>{error.message}</div>
        )}
      </div>
      {onDismiss && (
        <button
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          ✕
        </button>
      )}
    </div>
  );
};
