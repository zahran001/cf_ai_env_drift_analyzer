import type {
  CompareRequest,
  CompareStartResponse,
  CompareStatusResponse,
} from "@shared/api";

/**
 * Get API base URL with graceful fallback for Jest testing.
 * In Vite/ESM, import.meta.env is available.
 * In Jest, we default to empty string (relative URLs).
 */
let _apiBase: string | undefined;
function getApiBase(): string {
  if (_apiBase !== undefined) {
    return _apiBase;
  }
  try {
    // @ts-ignore - import.meta is valid in ESM/Vite but requires ts-jest ESM support
    const meta = (import.meta as any);
    _apiBase = (meta?.env?.VITE_API_BASE_URL as string) ?? "";
  } catch {
    _apiBase = "";
  }
  return _apiBase;
}

const API_BASE = getApiBase();

/**
 * HTTP helper for API calls.
 * Always uses cache: 'no-store' to ensure fresh data on every request.
 * Critical for comparison freshness and polling loop correctness.
 */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
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
