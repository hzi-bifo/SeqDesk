/**
 * SeqDesk License System
 *
 * Enterprise licensing for self-hosted installations.
 *
 * How it works:
 * 1. Customer purchases license at seqdesk.com
 * 2. Customer receives a license key (signed JWT)
 * 3. Customer enters key in Admin > Platform Settings > License
 * 4. App validates the key and unlocks features
 *
 * License types:
 * - Trial: 14 days, all features, 5 users
 * - Standard: 1 year, basic features, 10 users
 * - Professional: 1 year, all features, 50 users
 * - Enterprise: 1 year, all features, unlimited users
 */

export * from './types';
export * from './validator';
