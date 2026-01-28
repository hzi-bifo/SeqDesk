/**
 * License Validator
 *
 * Validates license keys (signed JWTs) using a public key.
 * The private key is kept on the license server (seqdesk.com).
 *
 * License keys are generated at: https://seqdesk.com/admin/licenses
 * Customers enter the key in: Admin > Platform Settings > License
 */

import type { LicenseData, LicenseStatus } from './types';

// Public key for license verification (RSA or Ed25519)
// This key can only VERIFY signatures, not create them
// Replace with your actual public key
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyDOxLPLLXC4BhPLK1cQsP1LNVYs+V8lXHl4UQNh/g/X7GCJz6P3V+Q2qVEgBJ5kPLRyXGLCOOAEqT5TqmC/xnKGhpLe5JH5T1jQPIhPIXnKFCmWE5k6v6KPBQ/zFGFSJAVYlZzklYpLHCL5hJPRFJbNVxDCWdGkXZAHJKNJYkxPLLCOOAEqT5TqmC/xnKGhpLe5JH5T1jQPIhPIXnKFCmWE5k6v6KPBQ/zFGFSJAVYlZzklYpLHCL5hJPRFJbNVxDCWdGkXZAHJKNJYkxPLHwz8YJ5YKL1QZF3V+Q2qVEgBJ5kPLRyXGLCOOAEqT5TqmC/xnKGhpLe5QIDAQAB
-----END PUBLIC KEY-----`;

// For development/testing: Allow unsigned licenses
const ALLOW_DEV_LICENSE = process.env.NODE_ENV === 'development';

/**
 * Decode a base64url string
 */
function base64UrlDecode(str: string): string {
  // Replace base64url characters with base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' if necessary
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Parse a JWT without verification (for reading claims)
 */
function parseJwtPayload(token: string): LicenseData | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload as LicenseData;
  } catch {
    return null;
  }
}

/**
 * Verify JWT signature using the public key
 */
async function verifyJwtSignature(token: string): Promise<boolean> {
  try {
    // In production, use a proper JWT library with crypto verification
    // For now, we do a simple structure check
    // TODO: Implement proper RSA/Ed25519 signature verification

    const parts = token.split('.');
    if (parts.length !== 3) return false;

    // Check header
    const header = JSON.parse(base64UrlDecode(parts[0]));
    if (header.typ !== 'JWT') return false;
    if (!['RS256', 'ES256', 'EdDSA'].includes(header.alg)) return false;

    // In development, allow unsigned tokens for testing
    if (ALLOW_DEV_LICENSE && header.alg === 'none') {
      return true;
    }

    // TODO: Proper signature verification with crypto
    // For now, we trust the structure if it looks valid
    // This should be replaced with actual cryptographic verification
    return parts[2].length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate a license key
 */
export async function validateLicense(licenseKey: string): Promise<LicenseStatus> {
  if (!licenseKey || licenseKey.trim() === '') {
    return {
      valid: false,
      license: null,
      error: 'No license key provided',
    };
  }

  // Parse the JWT payload
  const licenseData = parseJwtPayload(licenseKey);
  if (!licenseData) {
    return {
      valid: false,
      license: null,
      error: 'Invalid license key format',
    };
  }

  // Verify signature
  const signatureValid = await verifyJwtSignature(licenseKey);
  if (!signatureValid) {
    return {
      valid: false,
      license: null,
      error: 'Invalid license signature',
    };
  }

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(licenseData.expiresAt);
  const isExpired = expiresAt < now;
  const daysRemaining = Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (isExpired) {
    return {
      valid: false,
      license: licenseData,
      error: 'License has expired',
      isExpired: true,
      daysRemaining: 0,
    };
  }

  return {
    valid: true,
    license: licenseData,
    daysRemaining,
    isExpired: false,
    isTrial: licenseData.type === 'trial',
  };
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(
  license: LicenseData | null,
  feature: keyof LicenseData['features']
): boolean {
  if (!license) return false;
  return license.features[feature] === true;
}

/**
 * Check if user limit is reached
 */
export function isUserLimitReached(
  license: LicenseData | null,
  currentUsers: number
): boolean {
  if (!license) return true;
  if (license.maxUsers === 0) return false; // Unlimited
  return currentUsers >= license.maxUsers;
}

/**
 * Get a human-readable license summary
 */
export function getLicenseSummary(status: LicenseStatus): string {
  if (!status.valid || !status.license) {
    return status.error || 'No valid license';
  }

  const { license, daysRemaining } = status;
  const typeLabel = license.type.charAt(0).toUpperCase() + license.type.slice(1);
  const userLimit =
    license.maxUsers === 0 ? 'unlimited users' : `${license.maxUsers} users`;

  let summary = `${typeLabel} License - ${license.customer} (${userLimit})`;

  if (daysRemaining !== undefined) {
    if (daysRemaining <= 30) {
      summary += ` - Expires in ${daysRemaining} days`;
    }
  }

  return summary;
}

/**
 * Generate a development/test license (only works in dev mode)
 */
export function generateDevLicense(
  customer: string,
  daysValid: number = 30
): string {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Dev licenses can only be generated in development mode');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000);

  const payload: LicenseData = {
    id: `dev-${Date.now()}`,
    customer,
    email: 'dev@localhost',
    type: 'enterprise',
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxUsers: 0, // Unlimited
    features: {
      pipelines: true,
      enaSubmission: true,
      aiValidation: true,
      multiDepartment: true,
      api: true,
      customBranding: true,
    },
  };

  // Create unsigned JWT for development
  const header = { alg: 'none', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return `${headerB64}.${payloadB64}.`;
}
