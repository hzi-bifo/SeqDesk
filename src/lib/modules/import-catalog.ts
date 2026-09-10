// Client-safe catalog for downloadable raw-read modules. The server uses
// providerId to gate import jobs; facility orders are not download providers.
export const importModuleCatalog = [
  {
    id: "import-cami", providerId: "cami-benchmark", source: "cami",
    name: "CAMI benchmark reads", category: "Benchmarks",
    summary: "Import short or long reads from CAMI benchmarks, together with sample metadata.",
    description: "Browse CAMI II Marine and CAMI III toy human-gut samples. Import raw short or long reads with benchmark metadata and citations.",
    formats: ["Paired-end short reads", "Long reads"],
  },
  {
    id: "import-sra", providerId: "ena-fastq-accession", source: "sra",
    name: "SRA / ENA reads", category: "Public repositories",
    summary: "Find public sequencing data by accession and import FASTQ reads with source metadata.",
    description: "Look up public run, sample or project accessions. Import ENA-hosted FASTQ files with original sample, experiment and repository study metadata.",
    formats: ["Single-end FASTQ", "Paired-end FASTQ"],
  },
] as const;

// Facility requests are creation actions, separate from file import modules.
export const dataSourceModuleCatalog = importModuleCatalog;

export type DataSourceModule = typeof dataSourceModuleCatalog[number];
