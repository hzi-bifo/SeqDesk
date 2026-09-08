import type { PackageOutputTable } from "@/lib/pipelines/package-loader";

/**
 * Table descriptions for pipeline outputs whose packages do not (yet) declare
 * `outputs[].table` in their manifest. A manifest declaration always wins;
 * this list only keeps older packages usable.
 */
export const KNOWN_PIPELINE_TABLES: Record<string, PackageOutputTable & { label: string }> = {
  "metaxpath:sample_profile": {
    label: "MetaxPath per-sample profiles",
    tableKind: "taxon-profile-long",
    format: "tsv",
    roles: {
      taxon: "speciesName",
      taxon_id: "speciesTaxID",
      rank: "taxRank",
      count: "numReads",
      value: "abundance",
    },
  },
  "study-demo-report:sample_summary": {
    label: "Demo report sample summary",
    tableKind: "sample-summary",
    format: "tsv",
    sampleColumn: "sample_id",
  },
  "kraken2-bracken:bracken_report": {
    label: "Bracken abundance report",
    tableKind: "taxon-profile-long",
    format: "tsv",
    roles: { taxon: "name", taxon_id: "taxonomy_id", rank: "taxonomy_lvl", count: "new_est_reads", value: "fraction_total_reads" },
  },
};

export function knownPipelineTable(pipelineId: string, outputId: string): (PackageOutputTable & { label: string }) | null {
  return KNOWN_PIPELINE_TABLES[`${pipelineId}:${outputId}`] ?? null;
}
