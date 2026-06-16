// Shared, framework-free builder for the OrderFormConfig.schema JSON shape.
//
// SINGLE SOURCE for the {fields, groups, enabledMixsChecklists, moduleDefaultsVersion}
// envelope stored in OrderFormConfig.schema (a JSON STRING column). Both the in-app
// infrastructure importer (Next/TS route — imports this .mjs) and the install-time
// apply-core (plain Node ESM .mjs — Slice 2) must produce the SAME shape so importing
// settings.json.forms.order matches the installer's applyOrderForm at the
// STORE + SHAPE + VERSION-KEY level.
//
// Authored as .mjs (not .ts) on purpose: apply-core.mjs is executed raw by node at
// install time with no TS/transpile step, and TS can import .mjs but .mjs cannot
// import TS. So the only direction that works for code sharing is TS -> .mjs.
//
// THE version key is `moduleDefaultsVersion` (the key the in-app GET
// /api/admin/form-config reader and scripts/apply-form-configs.mjs read), NOT the
// orphan `installProfileDefaultsVersion`. ORDER_FORM_DEFAULTS_VERSION mirrors
// src/lib/modules/default-form-fields.ts (ORDER_FORM_DEFAULTS_VERSION = 4); keep these
// two values identical.

export const ORDER_FORM_DEFAULTS_VERSION = 4;

/**
 * Build the OrderFormConfig.schema object from a forms.order embedded blob.
 *
 * @param {object} input
 * @param {Array} [input.fields]                  - FormFieldDefinition[]
 * @param {Array} [input.groups]                  - FormFieldGroup[]
 * @param {Array} [input.enabledMixsChecklists]   - string[]
 * @param {number} [input.moduleDefaultsVersion]  - defaults to ORDER_FORM_DEFAULTS_VERSION
 * @returns {{fields: Array, groups: Array, enabledMixsChecklists: Array, moduleDefaultsVersion: number}}
 */
export function buildOrderFormSchema(input = {}) {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const groups = Array.isArray(input.groups) ? input.groups : [];
  const enabledMixsChecklists = Array.isArray(input.enabledMixsChecklists)
    ? input.enabledMixsChecklists
    : [];
  const moduleDefaultsVersion =
    typeof input.moduleDefaultsVersion === "number"
      ? input.moduleDefaultsVersion
      : ORDER_FORM_DEFAULTS_VERSION;

  return {
    fields,
    groups,
    enabledMixsChecklists,
    moduleDefaultsVersion,
  };
}
