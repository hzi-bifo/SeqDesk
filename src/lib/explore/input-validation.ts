import { db } from "@/lib/db";
import { datasetFitsInput, datasetFitMessage } from "./dataset-kinds";
import { parseRoles, parseSchema } from "./schema";
import { KitInputSchema, type KitInput } from "./kits/schema";
import type { AnalysisInputBinding } from "./analyses";
import type { GenerationSnapshot } from "./report-generation";

/** Stored with the revision, so later kit updates cannot rewrite its input requirements. */
export function inputContractSnapshot(raw: string | null | undefined): KitInput[] | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || Array.isArray(value) || value.version !== 1) return null;
    return KitInputSchema.array().parse(value.contract);
  } catch { return null; }
}

export function serializeInputs(bindings: AnalysisInputBinding[], contract: KitInput[] | null, generation?: GenerationSnapshot | null): string {
  return JSON.stringify(contract || generation ? { version: 1, bindings, contract, ...(generation ? { generation } : {}) } : bindings);
}

/** Validate and pin the exact versions BEFORE creating a run or starting any process. */
export async function validateAnalysisInputs(targetKey: string, bindings: AnalysisInputBinding[], contract: KitInput[] | null) {
  const aliases = new Set<string>();
  for (const binding of bindings) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(binding.alias) || aliases.has(binding.alias)) throw new Error("Input aliases must be unique, short snake_case names.");
    aliases.add(binding.alias);
  }
  for (const input of contract ?? []) {
    if (!input.optional && !aliases.has(input.alias)) throw new Error(`${input.label}: choose a table.`);
  }
  const pinned: AnalysisInputBinding[] = [];
  for (const binding of bindings) {
    const dataset = await db.exploreDataset.findFirst({ where: { id: binding.datasetId, targetKey } });
    if (!dataset) throw new Error(`Input ${binding.alias}: table is not available in this scope.`);
    const version = await db.exploreDatasetVersion.findFirst({ where: { datasetId: dataset.id, id: binding.versionId ?? dataset.currentVersionId ?? "" } });
    if (!version) throw new Error(`Input ${binding.alias}: the chosen table version is unavailable.`);
    if (version.rowCount === 0) throw new Error(`Input ${binding.alias}: the table has no rows.`);
    const requirement = contract?.find(input => input.alias === binding.alias);
    if (contract && !requirement) throw new Error(`Unknown template input: ${binding.alias}.`);
    if (requirement) {
      const fit = datasetFitsInput({ tableKind: dataset.tableKind, roles: parseRoles(dataset.roles), schema: parseSchema(version.schema) }, requirement);
      if (!fit.ok) throw new Error(`${requirement.label}: ${datasetFitMessage(fit)}`);
    }
    pinned.push({ ...binding, versionId: version.id });
  }
  return pinned;
}
