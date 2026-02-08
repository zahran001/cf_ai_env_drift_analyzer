import { useState } from "react";
import type { CompareRequest } from "@shared/api";
import styles from "./ControlPlane.module.css";

export interface ControlPlaneProps {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  onLeftUrlChange: (value: string) => void;
  onRightUrlChange: (value: string) => void;
  onLeftLabelChange: (value: string) => void;
  onRightLabelChange: (value: string) => void;
  onSubmit: (req: CompareRequest) => void;
  isLoading: boolean;
}

/**
 * ControlPlane: Input header for URLs, labels, swap button, and submit.
 *
 * Controlled component — parent owns all form state via props + onChange callbacks.
 *
 * Features:
 * - Two URL input fields (left and right, required)
 * - Two optional label input fields
 * - Swap button to exchange URLs + labels bidirectionally
 * - Submit button (disabled during loading)
 * - Client-side preflight warning for localhost/private IPs (UX sugar, inline, non-blocking)
 * - Form validation (both URLs required)
 *
 * Rendering:
 * - Single column on mobile (320-480px)
 * - Side-by-side on tablet+ (481px+)
 */
export function ControlPlane({
  leftUrl,
  rightUrl,
  leftLabel = "",
  rightLabel = "",
  onLeftUrlChange,
  onRightUrlChange,
  onLeftLabelChange,
  onRightLabelChange,
  onSubmit,
  isLoading,
}: ControlPlaneProps) {
  const [showPrivateWarning, setShowPrivateWarning] = useState(false);
  const [privateWarningMessage, setPrivateWarningMessage] = useState("");

  const isPrivate = (url: string) => {
    try {
      const { hostname } = new URL(url);
      return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("172.") ||
        hostname.startsWith("169.254.")
      );
    } catch {
      return false;
    }
  };

  const handleSwap = () => {
    const tmpLeftUrl = leftUrl;
    const tmpLeftLabel = leftLabel;
    onLeftUrlChange(rightUrl);
    onRightUrlChange(tmpLeftUrl);
    onLeftLabelChange(rightLabel);
    onRightLabelChange(tmpLeftLabel);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!leftUrl.trim() || !rightUrl.trim()) {
      return;
    }

    const leftIsPrivate = isPrivate(leftUrl);
    const rightIsPrivate = isPrivate(rightUrl);

    if (leftIsPrivate || rightIsPrivate) {
      const urls = [];
      if (leftIsPrivate) urls.push("left");
      if (rightIsPrivate) urls.push("right");
      setPrivateWarningMessage(
        `${urls.join(" and ")} URL appears to be private/local`
      );
      setShowPrivateWarning(true);
      return;
    }

    onSubmit({
      leftUrl: leftUrl.trim(),
      rightUrl: rightUrl.trim(),
      leftLabel: leftLabel.trim() || undefined,
      rightLabel: rightLabel.trim() || undefined,
    });
  };

  const isFormValid = leftUrl.trim() && rightUrl.trim();

  return (
    <form className={styles.container} onSubmit={handleSubmit}>
      <div className={styles.urlInputs}>
        {/* Left URL Section */}
        <div className={styles.inputGroup}>
          <label htmlFor="leftUrl" className={styles.label}>
            Left URL <span className={styles.required}>*</span>
          </label>
          <input
            id="leftUrl"
            type="url"
            className={styles.urlInput}
            placeholder="https://staging.example.com/api/health"
            value={leftUrl}
            onChange={(e) => onLeftUrlChange(e.target.value)}
            disabled={isLoading}
            required
          />
          <label htmlFor="leftLabel" className={styles.label}>
            Label <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="leftLabel"
            type="text"
            className={styles.textInput}
            placeholder="e.g., Staging"
            value={leftLabel}
            onChange={(e) => onLeftLabelChange(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* Right URL Section */}
        <div className={styles.inputGroup}>
          <label htmlFor="rightUrl" className={styles.label}>
            Right URL <span className={styles.required}>*</span>
          </label>
          <input
            id="rightUrl"
            type="url"
            className={styles.urlInput}
            placeholder="https://prod.example.com/api/health"
            value={rightUrl}
            onChange={(e) => onRightUrlChange(e.target.value)}
            disabled={isLoading}
            required
          />
          <label htmlFor="rightLabel" className={styles.label}>
            Label <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="rightLabel"
            type="text"
            className={styles.textInput}
            placeholder="e.g., Production"
            value={rightLabel}
            onChange={(e) => onRightLabelChange(e.target.value)}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Inline Private IP Warning (non-blocking) */}
      {showPrivateWarning && (
        <div className={styles.warningBanner}>
          <div className={styles.warningText}>
            ⚠️ {privateWarningMessage}. This will likely fail.
          </div>
          <button
            type="button"
            className={styles.warningDismiss}
            onClick={() => setShowPrivateWarning(false)}
            title="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.swapButton}
          onClick={handleSwap}
          disabled={isLoading}
          title="Swap URLs and labels"
        >
          ⇄ Swap
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={!isFormValid || isLoading}
        >
          {isLoading ? "Comparing..." : "Compare"}
        </button>
      </div>
    </form>
  );
}
