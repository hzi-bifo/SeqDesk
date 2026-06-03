/**
 * Back-compat mapping for MIxS checklist references stored on a study.
 *
 * New studies persist the checklist's ENA accession (e.g. "ERC000022") in
 * `Study.checklistType`, which resolves directly against the registry. Older
 * studies were created when the picker offered a fixed set of slug-style ids
 * (e.g. "soil", "human-gut"); this module maps those legacy ids to the
 * matching accession so they keep resolving via `getChecklistForStudy`.
 *
 * Kept dependency-free (no React / lucide imports) so it is safe to import on
 * the server as well as in client components.
 */

/** Old picker slug ids -> ENA accession. */
export const LEGACY_CHECKLIST_ALIASES: Record<string, string> = {
  "human-gut": "ERC000015",
  "human-oral": "ERC000016",
  "human-skin": "ERC000017",
  "human-associated": "ERC000014",
  "host-associated": "ERC000013",
  "plant-associated": "ERC000020",
  soil: "ERC000022",
  water: "ERC000024",
  "wastewater-sludge": "ERC000023",
  air: "ERC000012",
  sediment: "ERC000021",
  "microbial-mat": "ERC000019",
  "misc-environment": "ERC000025",
};

/**
 * Turn a stored `checklistType` value into a registry lookup ref.
 *
 * - falsy -> `{}` (nothing to resolve)
 * - "ERC000022" -> `{ accession }`
 * - known legacy slug -> `{ accession }` (mapped via {@link LEGACY_CHECKLIST_ALIASES})
 * - anything else -> `{ name }` so substring name resolution still works for
 *   legacy / free-form values.
 */
export function resolveChecklistRef(
  stored: string | null | undefined
): { accession?: string; name?: string } {
  if (!stored) return {};

  if (/^ERC\d+$/i.test(stored)) {
    return { accession: stored };
  }

  const alias = LEGACY_CHECKLIST_ALIASES[stored];
  if (alias) {
    return { accession: alias };
  }

  return { name: stored };
}
