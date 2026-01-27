/**
 * Field Types Initialization
 *
 * This file imports and registers all field type plugins.
 * Import this file once at the app root to ensure all field types are available.
 */

// Import standard field types (auto-registers)
import "./standard";

// Import special field types
import "./mixs";
import "./funding";
import "./billing";
import "./sequencing-tech";

// Re-export everything from the main index
export * from "./index";
export * from "./standard";
export * from "./mixs";
export * from "./funding";
export * from "./billing";
export * from "./sequencing-tech";
export { MixsAdminEditor } from "./mixs/MixsAdminEditor";
export { MixsFormRenderer } from "./mixs/MixsFormRenderer";
export { FundingAdminEditor } from "./funding/FundingAdminEditor";
export { FundingFormRenderer } from "./funding/FundingFormRenderer";
export { BillingAdminEditor } from "./billing/BillingAdminEditor";
export { BillingFormRenderer } from "./billing/BillingFormRenderer";
export { SequencingTechAdminEditor } from "./sequencing-tech/SequencingTechAdminEditor";
export { SequencingTechFormRenderer } from "./sequencing-tech/SequencingTechFormRenderer";
