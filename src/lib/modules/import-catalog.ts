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

// Public-record connectors (Workbench datasets, not reads). Kept apart from the
// raw-read catalog above so the sequencing-data source pickers do not list them;
// the server gates them per module exactly like the raw-read importers.
export const connectorModuleCatalog = [
  { id: "import-zenodo", providerId: "zenodo-record", name: "Zenodo records", category: "Public repositories",
    summary: "Download the open files of a Zenodo record, verified against Zenodo's checksums." },
  { id: "import-pdb", providerId: "pdb-entry", name: "PDB structures", category: "Structures",
    summary: "Download mmCIF structure files for PDB entries from RCSB." },
  { id: "import-alphafold", providerId: "alphafold-model", name: "AlphaFold models", category: "Structures",
    summary: "Download predicted structure models from the AlphaFold Protein Structure Database." },
  { id: "import-uniprot", providerId: "uniprot-entry", name: "UniProt entries", category: "Proteins",
    summary: "Download protein sequences (FASTA) and their UniProtKB entries." },
  { id: "import-reference", providerId: "reference-resource", name: "Reference resources", category: "Reference data",
    summary: "Install versioned reference tables (GO BP, MSigDB Hallmark) from their official sources, with licence and citation." },
] as const;

// Facility requests are creation actions, separate from file import modules.
export const dataSourceModuleCatalog = importModuleCatalog;

export type DataSourceModule = typeof dataSourceModuleCatalog[number];
