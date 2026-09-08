// Client-safe catalog for the bundled modules. No remote plugin installation.
export const importModuleCatalog = [
  {
    id: "import-cami", providerId: "cami-benchmark", source: "cami",
    name: "CAMI benchmark reads", category: "Benchmarks",
    description: "Browse CAMI II Marine and CAMI III toy human-gut samples. Import raw short or long reads with benchmark metadata and citations.",
    formats: ["Paired-end short reads", "Long reads"],
  },
  {
    id: "import-sra", providerId: "ena-fastq-accession", source: "sra",
    name: "SRA / ENA reads", category: "Public repositories",
    description: "Look up public run, sample or project accessions. Import ENA-hosted FASTQ files with original sample, experiment and repository study metadata.",
    formats: ["Single-end FASTQ", "Paired-end FASTQ"],
  },
] as const;
