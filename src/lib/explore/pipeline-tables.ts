import type { PackageOutputTable } from "@/lib/pipelines/package-loader";

/**
 * Table descriptions for pipeline outputs whose packages do not (yet) declare
 * `outputs[].table` in their manifest. A manifest declaration always wins;
 * this list only keeps older packages usable.
 */
export const KNOWN_PIPELINE_TABLES: Record<string, PackageOutputTable & { label: string }> = {
  // Older FastQC installations already wrote this TSV. Expose those saved
  // artifacts without reinstalling the package or rerunning the FASTQs.
  "fastqc:summary": {
    label: "FastQC quality summary",
    description: "Read counts, mean Phred quality and FastQC PASS / WARN / FAIL check counts for R1 and R2. One row per sample; missing R2 values stay empty for single-end reads.",
    tableKind: "sample-summary",
    format: "tsv",
    sampleColumn: "sample_id",
    columnLabels: {
      r1_pass: "R1 passed checks", r1_warn: "R1 warnings", r1_fail: "R1 failed checks",
      r1_read_count: "R1 reads", r1_avg_quality: "R1 mean quality (Phred)",
      r2_pass: "R2 passed checks", r2_warn: "R2 warnings", r2_fail: "R2 failed checks",
      r2_read_count: "R2 reads", r2_avg_quality: "R2 mean quality (Phred)",
    },
  },
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
