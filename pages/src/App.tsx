import { useState } from "react";
import { startCompare } from "./lib/api";
import { useComparisonPoll } from "./hooks/useComparisonPoll";

export default function App() {
  const [leftUrl, setLeftUrl] = useState("");
  const [rightUrl, setRightUrl] = useState("");
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const poll = useComparisonPoll<any>(comparisonId);

  async function onCompare() {
    setComparisonId(null);
    const { comparisonId } = await startCompare({ leftUrl, rightUrl });
    setComparisonId(comparisonId);
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>cf_ai_env_drift_analyzer</h1>
      <p>Compare two environments and get an explanation for drift (MVP UI).</p>

      <div style={{ display: "grid", gap: 8 }}>
        <input
          placeholder="Left URL (e.g., https://staging.example.com/api/health)"
          value={leftUrl}
          onChange={(e) => setLeftUrl(e.target.value)}
        />
        <input
          placeholder="Right URL (e.g., https://prod.example.com/api/health)"
          value={rightUrl}
          onChange={(e) => setRightUrl(e.target.value)}
        />
        <button
          onClick={onCompare}
          disabled={!leftUrl || !rightUrl || poll.status === "running"}
        >
          {poll.status === "running" ? "Comparing..." : "Compare"}
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <strong>Status:</strong> {poll.status}
        {comparisonId && (
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            comparisonId: <code>{comparisonId}</code>
          </div>
        )}

        {poll.error && (
          <pre style={{ marginTop: 12, padding: 12, background: "#fee" }}>
            {poll.error}
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
