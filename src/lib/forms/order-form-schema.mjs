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

// ---------------------------------------------------------------------------
// Shared, framework-free manage-merge helpers for the order-form path.
//
// These were the installer apply-core's local copies (scripts/lib/
// install-profile-apply-core.mjs). They moved here so the in-app infrastructure
// importer (TS) and the install-time apply-core (.mjs) compute the
// OrderFormConfig.schema with the EXACT same merge + bookkeeping logic, then
// persist a byte-identical shape. apply-core.mjs re-imports them from here.
//
// Keep them pure (no fs/path, no Next, no prisma) — apply-core.mjs is executed
// raw by node at install time.
// ---------------------------------------------------------------------------

export function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function toRecord(value) {
  return isRecord(value) ? value : {};
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function itemKey(item, fallbackPrefix) {
  if (typeof item.name === "string" && item.name.trim()) {
    return `name:${item.name.trim()}`;
  }
  if (typeof item.id === "string" && item.id.trim()) {
    return `id:${item.id.trim()}`;
  }
  return `${fallbackPrefix}:${JSON.stringify(item)}`;
}

export function mergeByKey(existingItems, incomingItems, keyFn) {
  const merged = [];
  const indexByKey = new Map();

  for (const item of existingItems) {
    if (!isRecord(item)) continue;
    const key = keyFn(item);
    indexByKey.set(key, merged.length);
    merged.push(item);
  }

  for (const item of incomingItems) {
    if (!isRecord(item)) continue;
    const key = keyFn(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
      continue;
    }
    merged[existingIndex] = {
      ...merged[existingIndex],
      ...item,
    };
  }

  return merged;
}

export function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const aOrder = typeof a.order === "number" ? a.order : 9999;
    const bOrder = typeof b.order === "number" ? b.order : 9999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.label || a.name || a.id || "").localeCompare(
      String(b.label || b.name || b.id || "")
    );
  });
}

export function isLegacyOrderPlatformField(field) {
  return (
    field?.id === "system_platform" ||
    field?.name === "platform" ||
    field?.systemKey === "platform"
  );
}

export function groupKey(group) {
  return `id:${group.id || group.name || ""}`;
}

export function managedItemKeys(items, keyFn) {
  return normalizeStringArray(
    (Array.isArray(items) ? items : [])
      .filter((item) => isRecord(item))
      .map((item) => keyFn(item))
  );
}

export function mergeManagedItems(
  existingItems,
  incomingItems,
  previousManagedKeys,
  keyFn
) {
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).filter(
    (item) => isRecord(item)
  );
  const incomingKeys = new Set(managedItemKeys(incoming, keyFn));
  const previousKeys = new Set(normalizeStringArray(previousManagedKeys));
  const existing = (Array.isArray(existingItems) ? existingItems : []).filter(
    (item) => {
      if (!isRecord(item)) return false;
      const key = keyFn(item);
      return !previousKeys.has(key) || incomingKeys.has(key);
    }
  );
  return {
    items: sortByOrder(mergeByKey(existing, incoming, keyFn)),
    managedKeys: Array.from(incomingKeys).sort(),
  };
}

export function mergeManagedGroups(
  existingGroups,
  incomingGroups,
  previousManagedKeys
) {
  return mergeManagedItems(
    existingGroups,
    incomingGroups,
    previousManagedKeys,
    groupKey
  );
}

export function mergeManagedFields(
  existingFields,
  incomingFields,
  previousManagedKeys
) {
  const withoutLegacy = (items) =>
    (Array.isArray(items) ? items : []).filter(
      (field) => !isLegacyOrderPlatformField(field)
    );
  return mergeManagedItems(
    withoutLegacy(existingFields),
    withoutLegacy(incomingFields),
    previousManagedKeys,
    (field) => itemKey(field, "field")
  );
}

export function mergeManagedStringArrays(
  existing,
  incoming,
  previousManagedValues
) {
  const incomingValues = normalizeStringArray(incoming);
  const incomingSet = new Set(incomingValues);
  const previousSet = new Set(normalizeStringArray(previousManagedValues));
  return {
    items: Array.from(
      new Set([
        ...(Array.isArray(existing)
          ? existing.filter(
              (item) =>
                typeof item === "string" &&
                (!previousSet.has(item.trim()) || incomingSet.has(item.trim()))
            )
          : []),
        ...incomingValues,
      ])
    ),
    managedKeys: incomingValues,
  };
}

/**
 * Build the next OrderFormConfig.schema OBJECT by manage-merging an incoming
 * forms.order blob over the EXISTING parsed schema. This is the SINGLE source of
 * the installer's applyOrderForm merge + installProfileManaged bookkeeping +
 * envelope, shared so the in-app importer writes an identical object.
 *
 * Pure: no prisma read/upsert, no empty-input early-return (callers gate the
 * write themselves). Takes an already-parsed existingSchema OBJECT.
 *
 * @param {object} args
 * @param {object} args.profileForm - {fields, groups, enabledMixsChecklists, defaultsVersion}
 * @param {object} [args.existingSchema] - parsed OrderFormConfig.schema object (or {})
 * @returns {{fields: Array, groups: Array, enabledMixsChecklists: Array, moduleDefaultsVersion: number, installProfileManaged: object} & Record<string, unknown>} the next schema object to JSON.stringify into the column
 */
export function buildOrderFormConfigSchema({ profileForm, existingSchema } = {}) {
  const existing = toRecord(existingSchema);
  const form = toRecord(profileForm);
  const managed = toRecord(existing.installProfileManaged);

  const groups = mergeManagedGroups(
    existing.groups,
    Array.isArray(form.groups) ? form.groups : [],
    managed.orderFormGroups
  );
  const fields = mergeManagedFields(
    existing.fields,
    Array.isArray(form.fields) ? form.fields : [],
    managed.orderFormFields
  );
  const enabledMixsChecklists = mergeManagedStringArrays(
    existing.enabledMixsChecklists,
    Array.isArray(form.enabledMixsChecklists) ? form.enabledMixsChecklists : [],
    managed.orderFormEnabledMixsChecklists
  );

  const nextSchema = {
    ...existing,
    // Build the canonical {fields, groups, enabledMixsChecklists,
    // moduleDefaultsVersion} envelope with the SAME shared helper every writer
    // uses. The version is stamped under `moduleDefaultsVersion` — the key the
    // in-app GET form-config / form-schema readers consult — NOT the orphan
    // `installProfileDefaultsVersion`.
    ...buildOrderFormSchema({
      groups: groups.items,
      fields: fields.items,
      enabledMixsChecklists: enabledMixsChecklists.items,
      moduleDefaultsVersion:
        typeof form.defaultsVersion === "number"
          ? form.defaultsVersion
          : ORDER_FORM_DEFAULTS_VERSION,
    }),
    installProfileManaged: {
      ...managed,
      orderFormGroups: groups.managedKeys,
      orderFormFields: fields.managedKeys,
      orderFormEnabledMixsChecklists: enabledMixsChecklists.managedKeys,
    },
  };
  // Drop any stale orphan version key carried forward by the spread above so a
  // re-apply over an old schema does not leave both keys.
  delete nextSchema.installProfileDefaultsVersion;
  return nextSchema;
}
