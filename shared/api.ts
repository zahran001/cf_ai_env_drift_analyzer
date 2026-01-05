export type CompareRequest = {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
};

export type CompareStartResponse = {
  comparisonId: string;
};

export type CompareStatus = "running" | "completed" | "failed";

export type CompareStatusResponse<ResultT = unknown> = {
  status: CompareStatus;
  result?: ResultT;
  error?: string;
};
