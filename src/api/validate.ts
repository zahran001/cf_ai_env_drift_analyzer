/**
 * URL validation for SSRF protection and input validation.
 * Per CLAUDE.md section 5.2.
 *
 * REJECTION CRITERIA (comprehensive):
 * - Non-http/https schemes (file://, ftp://, gopher://, etc.)
 * - Loopback: 127.0.0.0/8 (including 127.1, 127.255.255.255)
 * - Any localhost variant (localhost, localhost., ::1, [::1])
 * - Private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Link-local: 169.254.0.0/16, fe80::/10
 * - Any-address: 0.0.0.0/8
 * - IPv6-mapped IPv4 (::ffff:127.0.0.1, etc.)
 * - Numeric IP bypass: decimal (2130706433), hex (0x7f000001), octal (017700000001)
 *
 * @param urlString - The URL to validate
 * @returns { valid: true } or { valid: false, reason: string }
 */
export function validateProbeUrl(
  urlString: string
): { valid: true } | { valid: false; reason: string } {
  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  // Check scheme
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      valid: false,
      reason: `Unsupported scheme: ${url.protocol}`,
    };
  }

  // Check hostname
  const hostname = url.hostname.toLowerCase();

  // Reject numeric IP bypass attempts (decimal, hex, octal)
  if (isNumericIpBypass(hostname)) {
    return { valid: false, reason: "Numeric IP bypass detected" };
  }

  // Reject all localhost variants
  if (isLocalhost(hostname)) {
    return { valid: false, reason: "Localhost is not allowed" };
  }

  // Reject loopback range (127.0.0.0/8)
  if (isLoopbackIp(hostname)) {
    return { valid: false, reason: "Loopback IP address is not allowed" };
  }

  // Reject any-address range (0.0.0.0/8)
  if (isAnyAddressIp(hostname)) {
    return {
      valid: false,
      reason: "Any-address (0.0.0.0/8) is not allowed",
    };
  }

  // Reject private IP ranges
  if (isPrivateIp(hostname)) {
    return {
      valid: false,
      reason: "Private IP address is not allowed",
    };
  }

  // Reject link-local addresses
  if (isLinkLocalIp(hostname)) {
    return {
      valid: false,
      reason: "Link-local address is not allowed",
    };
  }

  // Reject IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1)
  if (isIpv6MappedIp(hostname)) {
    return {
      valid: false,
      reason: "IPv6-mapped IPv4 address detected",
    };
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
 * Check if hostname is localhost.
 * Covers: localhost, localhost., ::1, [::1], IPv6 uncompressed
 */
function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "localhost." ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0000:0000:0000:0000:0000:0000:0000:0001"
  );
}

/**
 * Check if hostname is in loopback range (127.0.0.0/8).
 * Covers: 127.0.0.1, 127.1, 127.255.255.255, etc.
 */
function isLoopbackIp(hostname: string): boolean {
  // Parse as IPv4
  const octets = parseIpv4(hostname);
  if (octets && octets[0] === 127) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is in any-address range (0.0.0.0/8).
 * Covers: 0.0.0.0, 0.0.0.1, 0.255.255.255, etc.
 */
function isAnyAddressIp(hostname: string): boolean {
  // Parse as IPv4
  const octets = parseIpv4(hostname);
  if (octets && octets[0] === 0) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is a private IPv4 address.
 * Private ranges:
 * - 10.0.0.0/8
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16
 */
function isPrivateIp(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) {
    // Not an IPv4 address; assume hostname is safe (public domains only)
    return false;
  }

  const [a, b] = octets;

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
 * IPv4 link-local: 169.254.0.0/16
 * IPv6 link-local: fe80::/10
 */
function isLinkLocalIp(hostname: string): boolean {
  // Check IPv4 link-local
  const octets = parseIpv4(hostname);
  if (octets) {
    const [a, b] = octets;
    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;
    return false;
  }

  // Check IPv6 link-local (fe80::/10)
  // Simple check: starts with fe80 followed by :
  if (/^fe80:/i.test(hostname)) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is an IPv6-mapped IPv4 address.
 * Examples: ::ffff:127.0.0.1, ::ffff:192.168.1.1
 */
function isIpv6MappedIp(hostname: string): boolean {
  // IPv6-mapped IPv4 format: ::ffff:a.b.c.d or ::FFFF:a.b.c.d
  const ipv6MappedPattern = /^::ffff:(.*)$/i;
  const match = hostname.match(ipv6MappedPattern);

  if (!match) {
    return false;
  }

  // Extract the IPv4 part and validate it
  const ipv4Part = match[1];
  const octets = parseIpv4(ipv4Part);

  if (!octets) {
    return false;
  }

  // If the mapped address is localhost/loopback/private, it's still dangerous
  const [a, b] = octets;

  // Check loopback (127.0.0.0/8)
  if (a === 127) return true;

  // Check any-address (0.0.0.0/8)
  if (a === 0) return true;

  // Check private ranges
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  // Check link-local
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Parse IPv4 address string to octet array.
 * Validates that each octet is 0-255.
 *
 * @param hostname - The IPv4 address to parse (e.g., "192.168.1.1")
 * @returns [a, b, c, d] if valid, null if invalid
 */
function parseIpv4(hostname: string): [number, number, number, number] | null {
  // Strict IPv4 pattern: exactly 4 octets separated by dots
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);

  if (!match) {
    return null;
  }

  const octets = match.slice(1).map(Number);

  // Validate each octet is in range 0-255
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}
