# SubMG Pipeline Package

This package exposes `submg` submission in SeqDesk's pipeline UI.

Execution is handled by SeqDesk's custom SubMG runner (`src/lib/pipelines/submg/submg-runner.ts`), which:
- Generates SubMG YAML files from study/sample/read/assembly/bin data.
- Executes `submg submit` for each generated config.
- Parses SubMG output logs and receipts.
- Persists ENA accession numbers back to SeqDesk models.

The package files are still required for the shared package loader and UI metadata.

## Citation

This pipeline runs **submg** ([github.com/ttubb/submg](https://github.com/ttubb/submg)), a tool that automates submission of metagenomic study data (samples, reads, assemblies, bins, and MAGs) to the European Nucleotide Archive (ENA). The orchestration and accession parsing around it are provided by SeqDesk.

If you use this pipeline, please cite **submg**:

- Tubbesing T, Schlüter A, Sczyrba A. subMG automates data submission for metagenomics studies. *BioData Mining*. 2025;18(1):38. doi:[10.1186/s13040-025-00453-w](https://doi.org/10.1186/s13040-025-00453-w)

Please also acknowledge SeqDesk (https://seqdesk.org), which orchestrates the submission and writes back ENA accessions.
