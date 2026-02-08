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
import type { LlmExplanation } from "@shared/llm";
import type { ComparisonState } from "../storage/envPairDO";

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
): Promise<LlmExplanation> {
  // Build LLM prompt
  const prompt = buildPrompt(diff, history);

  // Call Workers AI (Llama 3.3)
  let llmResponse: any;
  try {
    llmResponse = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any, {
      prompt,
      max_tokens: 1024,
    });
  } catch (err) {
    throw new Error(`Workers AI call failed: ${String(err)}`);
  }

  console.log("Workers AI raw response:", llmResponse);
  console.log("Workers AI response type:", typeof llmResponse);

  // Extract response (ai.run() returns { response, tool_calls, usage } directly)
  const aiResult = (llmResponse as any)?.response;
  if (typeof aiResult !== "string" || aiResult.trim().length === 0) {
    throw new Error(`Workers AI response missing/empty response field: ${JSON.stringify(llmResponse)}`);
  }

  // Extract and parse LLM output as JSON
  console.log("AI raw head:", aiResult.slice(0, 250));
  const jsonText = extractFirstJsonObject(aiResult);
  console.log("AI json head:", jsonText.slice(0, 250));

  let explanation: unknown;
  try {
    explanation = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `LLM output is not valid JSON: ${String(err)}\n` +
      `Extracted JSON head: ${jsonText.slice(0, 300)}`
    );
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
function validateExplanation(explanation: unknown): LlmExplanation {
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

  return obj as LlmExplanation;
}

/**
 * Strip markdown code fences from a string.
 * Handles ```json ... ``` or ``` ... ```
 */
function stripCodeFences(s: string): string {
  let t = s.trim();

  // Remove ```json ... ``` or ``` ... ```
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "");
    t = t.replace(/```$/i, "");
  }

  return t.trim();
}

/**
 * Extract the first complete JSON object from a string using balanced-brace parsing.
 * Handles:
 * - Preamble text (bullets, instructions, explanations)
 * - Code fences (```json ... ```)
 * - Repeated JSON objects (returns only the first one)
 * - Nested objects and arrays (correctly matches braces)
 * - Trailing junk after the first JSON object
 *
 * Uses a state machine to track string literals and escape sequences,
 * ensuring we don't confuse braces inside strings with actual JSON structure.
 *
 * Throws if no valid JSON object is found or braces are unmatched.
 */
function extractFirstJsonObject(raw: string): string {
  const s = stripCodeFences(raw);

  const start = s.indexOf("{");
  if (start === -1) {
    throw new Error(`No '{' found in model output. Head: ${s.slice(0, 300)}`);
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") depth--;

    if (depth === 0) {
      return s.slice(start, i + 1).trim();
    }
  }

  throw new Error(`Unclosed JSON object. Head: ${s.slice(start, start + 300)}`);
}
