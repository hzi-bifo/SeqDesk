import { ncbiGenomesTaxonImporter } from "./ncbi-genomes-taxon";
import type { WorkbenchImporterProvider } from "./types";

const providers = [ncbiGenomesTaxonImporter] as const satisfies readonly WorkbenchImporterProvider[];

export function listWorkbenchImporters(): WorkbenchImporterProvider[] {
  return [...providers];
}

export function getWorkbenchImporter(providerId: string): WorkbenchImporterProvider | null {
  return providers.find((provider) => provider.id === providerId) || null;
}

export function serializeWorkbenchImporter(provider: WorkbenchImporterProvider, preflight?: Awaited<ReturnType<WorkbenchImporterProvider["preflight"]>>) {
  return {
    id: provider.id,
    label: provider.label,
    description: provider.description,
    category: provider.category,
    preflight: preflight || null,
  };
}
