import { useState } from "react";
import { startCompare } from "./lib/api";
import { useComparisonPoll } from "./hooks/useComparisonPoll";
import { usePairHistory } from "./hooks/usePairHistory";

export default function App() {
  const [leftUrl, setLeftUrl] = useState("");
  const [rightUrl, setRightUrl] = useState("");
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const poll = useComparisonPoll<any>(comparisonId);
  const { history, savePair } = usePairHistory();

  async function onCompare() {
    setComparisonId(null);
    const { comparisonId } = await startCompare({
      leftUrl,
      rightUrl,
      leftLabel: leftLabel || undefined,
      rightLabel: rightLabel || undefined,
    });
    savePair(
      leftUrl,
      rightUrl,
      comparisonId,
      leftLabel || undefined,
      rightLabel || undefined
    );
    setComparisonId(comparisonId);
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>cf_ai_env_drift_analyzer</h1>
      <p>Compare two environments and get an explanation for drift (MVP UI).</p>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              Left URL
            </div>
            <input
              placeholder="https://staging.example.com/api/health"
              value={leftUrl}
              onChange={(e) => setLeftUrl(e.target.value)}
            />
            <input
              placeholder="Label (optional, e.g., 'Staging')"
              value={leftLabel}
              onChange={(e) => setLeftLabel(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              Right URL
            </div>
            <input
              placeholder="https://prod.example.com/api/health"
              value={rightUrl}
              onChange={(e) => setRightUrl(e.target.value)}
            />
            <input
              placeholder="Label (optional, e.g., 'Production')"
              value={rightLabel}
              onChange={(e) => setRightLabel(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
        </div>
        <button
          onClick={onCompare}
          disabled={!leftUrl || !rightUrl || poll.status === "running"}
        >
          {poll.status === "running" ? "Comparing..." : "Compare"}
        </button>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 24, padding: 12, background: "#f6f8fa", borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 8 }}>
            Recent pairs:
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {history.slice(0, 5).map((entry, i) => (
              <button
                key={i}
                onClick={() => {
                  setLeftUrl(entry.leftUrl);
                  setRightUrl(entry.rightUrl);
                  setLeftLabel(entry.leftLabel || "");
                  setRightLabel(entry.rightLabel || "");
                }}
                style={{
                  textAlign: "left",
                  padding: 8,
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <div>
                  {entry.leftLabel || entry.leftUrl} →{" "}
                  {entry.rightLabel || entry.rightUrl}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <strong>Status:</strong> {poll.status}
        {comparisonId && (
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            comparisonId: <code>{comparisonId}</code>
          </div>
        )}

        {poll.error && (
          <pre style={{ marginTop: 12, padding: 12, background: "#fee" }}>
            {typeof poll.error === "string"
              ? poll.error
              : `${poll.error.code}: ${poll.error.message}`}
          </pre>
        )}

        {poll.status === "completed" && poll.result && (
          <pre style={{ marginTop: 12, padding: 12, background: "#f6f8fa", overflowX: "auto" }}>
            {JSON.stringify(poll.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
