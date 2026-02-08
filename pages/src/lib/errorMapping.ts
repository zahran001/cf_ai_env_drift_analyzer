import type { CompareError, CompareErrorCode } from "@shared/api";

export interface ErrorGuidance {
  title: string;
  guidance: string;
}

const ERROR_GUIDANCE: Record<CompareErrorCode, ErrorGuidance> = {
  invalid_request: {
    title: "Invalid Input",
    guidance:
      "Check that both URLs are formatted correctly (e.g., https://example.com/path).",
  },
  invalid_url: {
    title: "Invalid URL Format",
    guidance: "Ensure both URLs are valid HTTP(S) addresses.",
  },
  ssrf_blocked: {
    title: "Private/Local Network Blocked",
    guidance:
      "Both URLs must be publicly accessible. Localhost, private IPs, and link-local addresses are not allowed.",
  },
  timeout: {
    title: "Request Timeout",
    guidance:
      "One or both URLs took too long to respond (>10s). Check that the servers are online.",
  },
  dns_error: {
    title: "DNS Resolution Failed",
    guidance:
      "One or both hostnames could not be resolved. Check the domain names.",
  },
  tls_error: {
    title: "TLS/HTTPS Error",
    guidance:
      "Certificate validation failed. Check that HTTPS is properly configured.",
  },
  fetch_error: {
    title: "Network Error",
    guidance: "A network error occurred. Check connectivity and try again.",
  },
  internal_error: {
    title: "Server Error",
    guidance:
      "An unexpected error occurred on the backend. Please try again or contact support.",
  },
};

export function getErrorGuidance(
  error?: CompareError | null
): ErrorGuidance | null {
  if (!error) return null;
  return (
    ERROR_GUIDANCE[error.code] ?? {
      title: "Unknown Error",
      guidance: "Please try again.",
    }
  );
}
