// src/analysis/probeUtils.ts
import type { SignalEnvelope, ProbeOutcomeDiff } from "@shared/diff";

export function compileProbeOutcomeDiff(
  left: SignalEnvelope,
  right: SignalEnvelope
): ProbeOutcomeDiff {
  const leftOk = left.result.ok;
  const rightOk = right.result.ok;
  const leftHasResponse = "response" in left.result;
  const rightHasResponse = "response" in right.result;

  return {
    leftOk,
    rightOk,
    leftErrorCode: !leftOk ? (left.result as any).error?.code : undefined,
    rightErrorCode: !rightOk ? (right.result as any).error?.code : undefined,
    outcomeChanged: leftOk !== rightOk,
    responsePresent: leftHasResponse && rightHasResponse,
  };
}
