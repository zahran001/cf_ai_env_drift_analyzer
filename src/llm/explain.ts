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
  // Build LLM messages (system + user roles for Llama 3.3 instruct)
  const messages = buildMessages(diff, history);

  // Call Workers AI (Llama 3.3) with messages format
  let llmResponse: any;
  try {
    llmResponse = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any, {
      messages,
      max_tokens: 1024,
    });
  } catch (err) {
    throw new Error(`Workers AI call failed: ${String(err)}`);
  }

  console.log("Workers AI raw response:", llmResponse);
  console.log("Workers AI response type:", typeof llmResponse);

  // Extract response (ai.run() returns { response, tool_calls, usage })
  // `response` may be a string (raw text) or an already-parsed object (valid JSON auto-parsed)
  const aiResult = (llmResponse as any)?.response;
  if (aiResult == null) {
    throw new Error(`Workers AI response missing response field: ${JSON.stringify(llmResponse)}`);
  }

  let explanation: unknown;
  if (typeof aiResult === "object") {
    // Workers AI already parsed the JSON for us
    explanation = aiResult;
  } else if (typeof aiResult === "string" && aiResult.trim().length > 0) {
    // Raw text — extract and parse JSON
    console.log("AI raw head:", aiResult.slice(0, 250));
    const jsonText = extractFirstJsonObject(aiResult);
    try {
      explanation = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(
        `LLM output is not valid JSON: ${String(err)}\n` +
        `Extracted JSON head: ${jsonText.slice(0, 300)}`
      );
    }
  } else {
    throw new Error(`Workers AI response field is empty: ${JSON.stringify(llmResponse)}`);
  }

  // Validate structure
  const validated = validateExplanation(explanation);

  return validated;
}

/**
 * Build messages array for LLM (system + user roles).
 *
 * Using the messages format (not legacy `prompt`) ensures Llama 3.3 instruct
 * correctly separates instructions from the data to analyze, preventing
 * the model from echoing system instructions back in its response.
 */
function buildMessages(
  diff: EnvDiff,
  history: ComparisonState[]
): Array<{ role: string; content: string }> {
  const MAX_FINDINGS_CHARS = 1500;
  const MAX_HISTORY_CHARS = 800;

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

    historySummary = `\nRecent similar comparisons:\n${historyLines}`;
    if (historySummary.length > MAX_HISTORY_CHARS) {
      historySummary = historySummary.slice(0, MAX_HISTORY_CHARS) + "\n... (truncated)";
    }
  }

  const systemMessage = `You are an environment drift analyzer. You receive deterministic findings comparing two web environments and produce a structured JSON explanation.

Respond with ONLY a raw JSON object. No preamble, no markdown, no code fences, no trailing text.

Required JSON structure:
{"summary":"string","ranked_causes":[{"cause":"string","confidence":number,"evidence":["string"]}],"actions":[{"action":"string","why":"string"}],"notes":["string"]}

Rules:
- confidence must be a number between 0 and 1
- base explanations on the provided findings only, not speculation
- if probes failed, explain the failure clearly
- keep explanations concise and technical`;

  const userMessage = `Analyze these environment comparison findings and return the JSON explanation.

FINDINGS:
${findingsSummary || "(No findings)"}
${historySummary}`;

  return [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];
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
