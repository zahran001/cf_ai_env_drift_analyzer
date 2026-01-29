/**
 * LLM-generated explanation output schema.
 *
 * Matches the Workers AI output validation contract from CLAUDE.md §1.3.
 * Structured JSON output from Llama 3.3 explaining diff findings with confidence scores.
 */

export type RankedCause = {
  /** Human-readable cause explanation (e.g., "CORS policy misconfiguration") */
  cause: string;

  /** Confidence in range [0, 1] (0% = speculative, 100% = certain) */
  confidence: number;

  /** Evidence strings grounding this cause in the diff */
  evidence: string[];
};

export type RecommendedAction = {
  /** Actionable next step (e.g., "Align CORS policies between environments") */
  action: string;

  /** Why this action is recommended (grounded in diff) */
  why: string;
};

export type LlmExplanation = {
  /** High-level summary of the comparison (1–2 sentences) */
  summary: string;

  /**
   * Ranked causes sorted by confidence (descending).
   * Each cause is grounded in the EnvDiff findings.
   */
  ranked_causes: RankedCause[];

  /**
   * Recommended actions to resolve drift.
   * Each action is grounded in the diff.
   */
  actions: RecommendedAction[];

  /**
   * Optional additional notes (e.g., caveats, context about findings).
   */
  notes?: string[];
};
