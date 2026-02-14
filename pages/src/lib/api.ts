import type {
  CompareRequest,
  CompareStartResponse,
  CompareStatusResponse,
  CompareError,
} from "@shared/api";

/**
 * Get API base URL with graceful fallback for Jest testing.
 * In Vite/ESM, import.meta.env is available.
 * In Jest, we default to empty string (relative URLs).
 */
let _apiBase: string | undefined;
export function getApiBase(): string {
  if (_apiBase !== undefined) {
    return _apiBase;
  }
  try {
    // @ts-ignore - import.meta is valid in ESM/Vite but requires ts-jest ESM support
    // Justified `any`: Vite/Jest interop requires dynamic access to import.meta.env
    const meta = (import.meta as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    _apiBase = (meta?.env?.VITE_API_BASE_URL as string) ?? "";
  } catch {
    _apiBase = "";
  }
  return _apiBase;
}

const API_BASE = getApiBase();

/**
 * Error thrown when the backend returns a non-OK response.
 * If the response body contains a CompareError object, it's attached as `compareError`.
 * This allows callers (e.g., App.tsx) to extract structured error info for ErrorBanner.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly compareError?: CompareError;

  constructor(status: number, message: string, compareError?: CompareError) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.compareError = compareError;
  }
}

/**
 * HTTP helper for API calls.
 * Always uses cache: 'no-store' to ensure fresh data on every request.
 * Critical for comparison freshness and polling loop correctness.
 *
 * On non-OK responses, attempts to parse the body as { error: CompareError }.
 * Throws ApiError with the structured error attached if available.
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
    // Attempt to extract CompareError from response body
    let compareError: CompareError | undefined;
    let text = "";
    try {
      text = await res.text();
      const parsed = JSON.parse(text);
      if (parsed?.error?.code && parsed?.error?.message) {
        compareError = parsed.error as CompareError;
      }
    } catch {
      // Body is not JSON or doesn't contain CompareError — that's fine
    }

    throw new ApiError(
      res.status,
      compareError?.message ?? `HTTP ${res.status}: ${text || res.statusText}`,
      compareError
    );
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
