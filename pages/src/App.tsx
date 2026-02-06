import { useState } from "react";
import { startCompare } from "./lib/api";
import { useComparisonPoll } from "./hooks/useComparisonPoll";
import { usePairHistory } from "./hooks/usePairHistory";
import { ControlPlane } from "./components/ControlPlane";

export default function App() {
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const poll = useComparisonPoll<any>(comparisonId);
  const { history } = usePairHistory();

  async function handleCompareSubmit(req: any) {
    setComparisonId(null);
    const { comparisonId } = await startCompare(req);
    setComparisonId(comparisonId);
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>cf_ai_env_drift_analyzer</h1>
      <p>Compare two environments and get an explanation for drift (MVP UI).</p>

      <ControlPlane
        onSubmit={handleCompareSubmit}
        isLoading={poll.status === "running"}
      />

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
                  // History display only (ControlPlane now owns form state)
                  // User would need to manually re-enter or we'd need state lifting
                  console.log("Re-run:", entry);
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
