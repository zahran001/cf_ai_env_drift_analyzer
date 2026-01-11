/**
 * Evidence Validators
 *
 * Responsibility: Validate that evidence structures conform to Phase-B2.md §1.1 & §1.3
 * - Evidence key vocabulary compliance
 * - Lexicographic sorting of keys
 * - No duplicate keys
 * - Case sensitivity for headers
 *
 * Reference: Phase-B2.md §1.1, §1.3, CHUNK_4_DESIGN.md
 */

import type { DiffEvidence } from "@shared/diff";
import { VALID_EVIDENCE_KEYS } from "./constants";

export type ValidEvidenceSection = keyof typeof VALID_EVIDENCE_KEYS;

/**
 * Check if array is sorted lexicographically.
 *
 * @param keys - Array of strings to check
 * @returns true if array is sorted, false otherwise
 */
function isSorted(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] < keys[i - 1]) {
      return false;
    }
  }
  return true;
}

/**
 * Check if header name is valid (lowercase, alphanumeric and hyphens only).
 *
 * Valid format: lowercase letters, digits, hyphens (e.g., "cache-control", "x-custom-header")
 * Invalid: uppercase letters, spaces, other special characters
 *
 * @param name - Header name to validate
 * @returns true if valid header name, false otherwise
 */
function isValidHeaderName(name: string): boolean {
  // Must be lowercase and contain only alphanumeric characters and hyphens
  return name === name.toLowerCase() && /^[a-z0-9\-]+$/.test(name);
}

/**
 * Validate evidence array conforms to Phase-B2.md §1.1 & §1.3.
 *
 * Requirements:
 * 1. All `evidence.section` values must be valid section names
 * 2. All `evidence.keys` arrays must contain only valid keys for that section
 * 3. For headers section: any lowercase header name is valid
 * 4. All `evidence.keys` arrays must be lexicographically sorted
 * 5. No duplicate keys within a single evidence item
 * 6. Header names must be lowercase (case-sensitive)
 *
 * @param evidence - Array of DiffEvidence items to validate
 * @returns true if all evidence is valid, false if any violation found
 */
export function validateEvidenceKeys(evidence: DiffEvidence[]): boolean {
  for (const item of evidence) {
    // Verify section is valid
    const validSections = Object.keys(VALID_EVIDENCE_KEYS);
    if (!validSections.includes(item.section)) {
      return false;
    }

    // If keys is undefined or empty, it's valid for all sections
    if (!item.keys || item.keys.length === 0) {
      continue;
    }

    // Check for duplicate keys
    const keySet = new Set(item.keys);
    if (keySet.size !== item.keys.length) {
      return false;
    }

    // Verify keys are sorted lexicographically
    if (!isSorted(item.keys)) {
      return false;
    }

    // Verify keys are valid for section
    if (item.section === "headers") {
      // For headers: any lowercase header name is valid
      for (const key of item.keys) {
        if (!isValidHeaderName(key)) {
          return false;
        }
      }
    } else {
      // For other sections: keys must be in VALID_EVIDENCE_KEYS[section]
      const validKeys = VALID_EVIDENCE_KEYS[item.section as ValidEvidenceSection];
      for (const key of item.keys) {
        if (!validKeys.includes(key as never)) {
          return false;
        }
      }
    }
  }

  return true;
}
