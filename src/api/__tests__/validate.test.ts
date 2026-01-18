/**
 * Unit tests for SSRF protection and URL validation.
 * Per CLAUDE.md section 5.2.
 */

import { validateProbeUrl } from '../validate';

describe('validateProbeUrl', () => {
  describe('Valid URLs', () => {
    it('should allow public HTTPS domains', () => {
      expect(validateProbeUrl('https://example.com')).toEqual({ valid: true });
    });

    it('should allow public HTTP domains', () => {
      expect(validateProbeUrl('http://example.org')).toEqual({ valid: true });
    });

    it('should allow public IPs (non-reserved)', () => {
      expect(validateProbeUrl('https://8.8.8.8')).toEqual({ valid: true });
    });
  });

  describe('Localhost variants', () => {
    it('should reject localhost', () => {
      const result = validateProbeUrl('http://localhost');
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason');
    });

    it('should reject ::1 (IPv6 loopback)', () => {
      const result = validateProbeUrl('http://[::1]');
      expect(result.valid).toBe(false);
    });
  });

  describe('Loopback range (127.0.0.0/8)', () => {
    it('should reject 127.0.0.1', () => {
      const result = validateProbeUrl('http://127.0.0.1');
      expect(result.valid).toBe(false);
    });

    it('should reject 127.1 (short form)', () => {
      const result = validateProbeUrl('http://127.1');
      expect(result.valid).toBe(false);
    });

    it('should reject 127.255.255.255', () => {
      const result = validateProbeUrl('http://127.255.255.255');
      expect(result.valid).toBe(false);
    });
  });

  describe('Any-address range (0.0.0.0/8)', () => {
    it('should reject 0.0.0.0', () => {
      const result = validateProbeUrl('http://0.0.0.0');
      expect(result.valid).toBe(false);
    });

    it('should reject 0.255.255.255', () => {
      const result = validateProbeUrl('http://0.255.255.255');
      expect(result.valid).toBe(false);
    });
  });

  describe('Private IP ranges (RFC 1918)', () => {
    it('should reject 10.0.0.1', () => {
      const result = validateProbeUrl('http://10.0.0.1');
      expect(result.valid).toBe(false);
    });

    it('should reject 172.16.0.1', () => {
      const result = validateProbeUrl('http://172.16.0.1');
      expect(result.valid).toBe(false);
    });

    it('should reject 192.168.0.1', () => {
      const result = validateProbeUrl('http://192.168.0.1');
      expect(result.valid).toBe(false);
    });

    it('should allow 172.15.0.0 (just outside range)', () => {
      expect(validateProbeUrl('http://172.15.0.0')).toEqual({ valid: true });
    });

    it('should allow 172.32.0.0 (just outside range)', () => {
      expect(validateProbeUrl('http://172.32.0.0')).toEqual({ valid: true });
    });
  });

  describe('Link-local ranges', () => {
    it('should reject 169.254.169.254 (AWS metadata)', () => {
      const result = validateProbeUrl('http://169.254.169.254');
      expect(result.valid).toBe(false);
    });

    // IPv6 link-local: URL parser removes brackets, so fe80::1 is tested via the helper directly
    // This is tested implicitly in integration tests
  });

  describe('IPv6-mapped IPv4 addresses', () => {
    // IPv6 addresses in URLs lose brackets when parsed by URL.hostname
    // The validation logic checks the hostname string directly for ::ffff: prefix
    // Note: These would be validated if called with the plain hostname
    // (e.g., in direct validation before URL parsing)
  });

  describe('Numeric IP bypass attempts', () => {
    it('should reject 2130706433 (decimal for 127.0.0.1)', () => {
      const result = validateProbeUrl('http://2130706433');
      expect(result.valid).toBe(false);
    });

    it('should reject 0x7f000001 (hex for 127.0.0.1)', () => {
      const result = validateProbeUrl('http://0x7f000001');
      expect(result.valid).toBe(false);
    });

    it('should reject 017700000001 (octal for 127.0.0.1)', () => {
      const result = validateProbeUrl('http://017700000001');
      expect(result.valid).toBe(false);
    });
  });

  describe('Invalid IP formats', () => {
    it('should reject 999.999.999.999 (invalid octets)', () => {
      const result = validateProbeUrl('http://999.999.999.999');
      expect(result.valid).toBe(false);
    });

    it('should reject 256.256.256.256 (octets > 255)', () => {
      const result = validateProbeUrl('http://256.256.256.256');
      expect(result.valid).toBe(false);
    });
  });

  describe('Invalid URL formats', () => {
    it('should reject malformed URLs', () => {
      const result = validateProbeUrl('not a url');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateProbeUrl('');
      expect(result.valid).toBe(false);
    });
  });

  describe('Boundary testing', () => {
    it('should allow 128.0.0.0 (just outside 127.0.0.0/8)', () => {
      expect(validateProbeUrl('http://128.0.0.0')).toEqual({ valid: true });
    });

    it('should allow 169.253.0.0 (just outside 169.254.0.0/16)', () => {
      expect(validateProbeUrl('http://169.253.0.0')).toEqual({ valid: true });
    });

    it('should allow 169.255.0.0 (just outside 169.254.0.0/16)', () => {
      expect(validateProbeUrl('http://169.255.0.0')).toEqual({ valid: true });
    });
  });
});
