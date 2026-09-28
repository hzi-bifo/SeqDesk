import { ncbiGenomesTaxonImporter } from "./ncbi-genomes-taxon";
import { enaFastqAccessionImporter } from "./ena-fastq-accession";
import { camiBenchmarkImporter } from "./cami-benchmark";
import { zenodoRecordImporter } from "./zenodo-record";
import { pdbEntryImporter } from "./pdb-entry";
import { alphafoldModelImporter } from "./alphafold-model";
import { uniprotEntryImporter } from "./uniprot-entry";
import { referenceResourceImporter } from "./reference-resource";
import { figshareArticleImporter } from "./figshare-article";
import { dryadDatasetImporter } from "./dryad-dataset";
import { mgnifyDownloadsImporter } from "./mgnify-downloads";
import { geoSeriesImporter } from "./geo-series";
import { linkDownloadImporter } from "./link-download";
import { ncbiSraRunsImporter } from "./ncbi-sra-runs";
import { ncbiAssemblyImporter } from "./ncbi-assembly";
import type { WorkbenchImporterProvider } from "./types";

const providers = [
  camiBenchmarkImporter,
  enaFastqAccessionImporter,
  ncbiGenomesTaxonImporter,
  ncbiSraRunsImporter,
  ncbiAssemblyImporter,
  zenodoRecordImporter,
  pdbEntryImporter,
  alphafoldModelImporter,
  uniprotEntryImporter,
  referenceResourceImporter,
  figshareArticleImporter,
  dryadDatasetImporter,
  mgnifyDownloadsImporter,
  geoSeriesImporter,
  linkDownloadImporter,
] as const satisfies readonly WorkbenchImporterProvider[];

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
