/**
 * LLM Explanation Module
 *
 * Responsibility: Convert diff + history to structured explanation via Workers AI.
 *
 * Per CLAUDE.md 3.3:
 * - Must receive EnvDiff as input (never raw signals)
 * - Must receive history snippet from DO (not generated)
 * - Must call Workers AI with structured prompt
 * - Must validate JSON output before returning
 * - Must fail gracefully on invalid LLM output
 * - Must not catch and hide validation errors from caller
 */

import type { EnvDiff } from "@shared/diff";
import type { ComparisonState } from "../storage/envPairDO";

export interface ExplainedComparison {
  summary: string;
  ranked_causes: Array<{
    cause: string;
    confidence: number;
    evidence: string[];
  }>;
  actions: Array<{
    action: string;
    why: string;
  }>;
  notes?: string[];
}

/**
 * Explain diff using Workers AI (Llama 3.3).
 *
 * Receives:
 * - diff: EnvDiff with deterministic findings
 * - history: Optional array of previous comparison results for context
 * - ai: Workers AI binding
 *
 * Returns: Structured JSON explanation grounded in diff
 *
 * Throws: On LLM error, validation failure, or parse error
 */
export async function explainDiff(
  diff: EnvDiff,
  history: ComparisonState[],
  ai: Ai
): Promise<ExplainedComparison> {
  // Build LLM prompt
  const prompt = buildPrompt(diff, history);

  // Call Workers AI (Llama 3.3)
  let llmResponse: Response;
  try {
    llmResponse = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any, {
      prompt,
      max_tokens: 1024,
    });
  } catch (err) {
    throw new Error(`Workers AI call failed: ${String(err)}`);
  }

  // Parse response
  let responseJson: unknown;
  try {
    responseJson = await llmResponse.json();
  } catch (err) {
    throw new Error(`Failed to parse Workers AI response as JSON: ${String(err)}`);
  }

  // Extract result (Workers AI returns { result: { response: "..." } })
  const aiResult = (responseJson as any)?.result?.response;
  if (!aiResult) {
    throw new Error("Workers AI response missing result.response field");
  }

  // Parse LLM output as JSON
  let explanation: unknown;
  try {
    explanation = JSON.parse(aiResult);
  } catch (err) {
    throw new Error(`LLM output is not valid JSON: ${String(err)}`);
  }

  // Validate structure
  const validated = validateExplanation(explanation);

  return validated;
}

/**
 * Build prompt for LLM.
 *
 * Includes:
 * - Findings from diff (deterministic, truncated to prevent token overflow)
 * - Historical context (optional, truncated)
 * - Instructions to return JSON
 */
function buildPrompt(diff: EnvDiff, history: ComparisonState[]): string {
  const MAX_FINDINGS_CHARS = 1500;  // ~300 words
  const MAX_HISTORY_CHARS = 800;    // ~160 words

  // Build findings summary and truncate if too long
  let findingsSummary = diff.findings
    .map((f) => `- [${f.severity.toUpperCase()}] ${f.code}: ${f.message}`)
    .join("\n");

  if (findingsSummary.length > MAX_FINDINGS_CHARS) {
    findingsSummary = findingsSummary.slice(0, MAX_FINDINGS_CHARS) + "\n... (truncated)";
  }

  // Build history summary and truncate if too long
  let historySummary = "";
  if (history.length > 0) {
    const historyLines = history
      .slice(0, 3)
      .map((c) => {
        const result = c.result as any;
        return `- ${result?.summary || "No summary"}`;
      })
      .join("\n");

    historySummary = `\n\nRecent similar comparisons:\n${historyLines}`;
    if (historySummary.length > MAX_HISTORY_CHARS) {
      historySummary = historySummary.slice(0, MAX_HISTORY_CHARS) + "\n... (truncated)";
    }
  }

  return `You are analyzing differences between two environments based on deterministic findings.

FINDINGS:
${findingsSummary || "(No findings)"}

${historySummary}

Provide ONLY a valid JSON object matching this structure. Do not include any preamble, markdown formatting (like \`\`\`json), code blocks, or trailing text. Return the raw JSON object directly:

{
  "summary": "One-sentence summary of the key difference",
  "ranked_causes": [
    {
      "cause": "Root cause explanation",
      "confidence": 0.95,
      "evidence": ["evidence1", "evidence2"]
    }
  ],
  "actions": [
    {
      "action": "Recommended action",
      "why": "Why this action helps"
    }
  ],
  "notes": ["Optional context notes"]
}

Requirements:
- confidence must be a number between 0 and 1
- base explanations on the provided findings, not speculation
- if probes failed, explain the failure clearly
- keep explanations concise and technical`;
}

/**
 * Validate LLM output structure.
 *
 * Per CLAUDE.md 1.3, validate:
 * - JSON parses
 * - summary is string and non-empty
 * - ranked_causes is array
 * - Each cause has confidence in [0, 1]
 * - actions is array
 *
 * Throws on validation failure.
 */
function validateExplanation(explanation: unknown): ExplainedComparison {
  const obj = explanation as any;

  // Validate summary
  if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
    throw new Error("Invalid LLM output: summary must be non-empty string");
  }

  // Validate ranked_causes
  if (!Array.isArray(obj.ranked_causes)) {
    throw new Error("Invalid LLM output: ranked_causes must be array");
  }

  for (const cause of obj.ranked_causes) {
    if (typeof cause.cause !== "string") {
      throw new Error("Invalid LLM output: cause.cause must be string");
    }
    if (typeof cause.confidence !== "number" || cause.confidence < 0 || cause.confidence > 1) {
      throw new Error("Invalid LLM output: confidence must be number in [0, 1]");
    }
    if (!Array.isArray(cause.evidence)) {
      throw new Error("Invalid LLM output: evidence must be array");
    }
  }

  // Validate actions
  if (!Array.isArray(obj.actions)) {
    throw new Error("Invalid LLM output: actions must be array");
  }

  for (const action of obj.actions) {
    if (typeof action.action !== "string") {
      throw new Error("Invalid LLM output: action.action must be string");
    }
    if (typeof action.why !== "string") {
      throw new Error("Invalid LLM output: action.why must be string");
    }
  }

  return obj as ExplainedComparison;
}
