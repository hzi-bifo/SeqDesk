/**
 * SeqDesk License System
 *
 * Licenses are signed JWT tokens containing:
 * - Customer information
 * - Expiration date
 * - Feature flags
 * - User limits
 */

export interface LicenseData {
  /** License ID */
  id: string;

  /** Customer/Organization name */
  customer: string;

  /** Customer email */
  email: string;

  /** License type */
  type: 'trial' | 'standard' | 'professional' | 'enterprise';

  /** Issue date (ISO string) */
  issuedAt: string;

  /** Expiration date (ISO string) */
  expiresAt: string;

  /** Maximum number of users (0 = unlimited) */
  maxUsers: number;

  /** Enabled features */
  features: {
    pipelines: boolean;
    enaSubmission: boolean;
    aiValidation: boolean;
    multiDepartment: boolean;
    api: boolean;
    customBranding: boolean;
  };
}

export interface LicenseStatus {
  valid: boolean;
  license: LicenseData | null;
  error?: string;
  daysRemaining?: number;
  isExpired?: boolean;
  isTrial?: boolean;
}

export interface LicenseConfig {
  /** The license key (JWT) */
  key: string | null;

  /** When the license was last validated */
  lastValidated: string | null;

  /** Cached license data */
  cachedData: LicenseData | null;
}
