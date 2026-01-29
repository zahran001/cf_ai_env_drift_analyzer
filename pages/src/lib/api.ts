import type {
  CompareRequest,
  CompareStartResponse,
  CompareStatusResponse,
} from "@shared/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function startCompare(req: CompareRequest): Promise<CompareStartResponse> {
  return http<CompareStartResponse>("/api/compare", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getCompareStatus<ResultT = unknown>(
  comparisonId: string
): Promise<CompareStatusResponse<ResultT>> {
  return http<CompareStatusResponse<ResultT>>(`/api/compare/${comparisonId}`, {
    method: "GET",
  });
}
