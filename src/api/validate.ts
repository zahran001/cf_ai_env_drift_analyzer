/**
 * URL validation for SSRF protection and input validation.
 * Per CLAUDE.md section 5.2.
 */

/**
 * Validates a URL for safe probing.
 *
 * REJECTION CRITERIA:
 * - Non-http/https schemes (file://, ftp://, etc.)
 * - Localhost: 127.0.0.1, localhost, ::1
 * - Private IP ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Link-local: 169.254.0.0/16
 *
 * @param urlString - The URL to validate
 * @returns { valid: true } or { valid: false, reason: string }
 */
export function validateProbeUrl(urlString: string): { valid: true } | { valid: false; reason: string } {
  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  // Check scheme
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, reason: `Unsupported scheme: ${url.protocol}` };
  }

  // Check hostname
  const hostname = url.hostname.toLowerCase();

  // Reject numeric IP bypass attempts (e.g., 2130706433 for 127.0.0.1)
  if (isNumericIpBypass(hostname)) {
    return { valid: false, reason: "Numeric IP bypass detected" };
  }

  // Reject localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return { valid: false, reason: "Localhost is not allowed" };
  }

  // Reject private IP ranges
  if (isPrivateIp(hostname)) {
    return { valid: false, reason: "Private IP address is not allowed" };
  }

  // Reject link-local addresses
  if (isLinkLocalIp(hostname)) {
    return { valid: false, reason: "Link-local address is not allowed" };
  }

  return { valid: true };
}

/**
 * Check if hostname is a numeric IP bypass attempt.
 * Rejects: decimal integers (2130706433), hex (0x7f000001), octal (017700000001).
 */
function isNumericIpBypass(hostname: string): boolean {
  // Reject pure numeric hostnames (decimal IP bypass)
  // e.g., "2130706433" for 127.0.0.1
  if (/^\d+$/.test(hostname)) {
    return true;
  }

  // Reject hex/octal patterns
  // e.g., "0x7f000001" or "017700000001"
  if (/^0x/i.test(hostname) || /^0[0-7]+$/.test(hostname)) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is a private IPv4 address.
 * Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 */
function isPrivateIp(hostname: string): boolean {
  // Simple regex check for IPv4
  const ipv4Pattern =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);

  if (!match) {
    // Not an IPv4 address; assume hostname is safe (public domains only)
    return false;
  }

  const [, a, b] = match.map(Number);

  // 10.0.0.0/8
  if (a === 10) return true;

  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  return false;
}

/**
 * Check if hostname is a link-local address.
 * Link-local range: 169.254.0.0/16
 */
function isLinkLocalIp(hostname: string): boolean {
  const ipv4Pattern =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);

  if (!match) return false;

  const [, a, b] = match.map(Number);

  // 169.254.0.0/16
  if (a === 169 && b === 254) return true;

  return false;
}
