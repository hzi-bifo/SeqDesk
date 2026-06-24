# nf-core/mag Pipeline Package

This package describes how SeqDesk integrates the nf-core/mag pipeline.

## Contents

- manifest.json: Source of truth for inputs, outputs, and execution
- definition.json: Workflow DAG + process matchers
- registry.json: UI configuration and settings schema
- samplesheet.yaml: Declarative samplesheet generation
- parsers/: Output parsers (CheckM, GTDB-Tk)

## Notes

- Samplesheets are generated per-sample and require paired-end reads.
- Outputs are routed through the SeqDesk output resolver (no direct DB writes).
- If custom logic is needed, add scripts in scripts/.

## Citation

This package runs the upstream **nf-core/mag** Nextflow pipeline (v3.0.0;
<https://nf-co.re/mag>) for metagenome assembly and binning. It builds on a
number of third-party tools, including MEGAHIT/SPAdes (assembly), MetaBAT2,
MaxBin2 and CONCOCT (binning), DAS Tool (refinement), CheckM/BUSCO/GUNC (bin
QC), GTDB-Tk (taxonomy) and Prokka (annotation).

If you use this pipeline, please cite the nf-core/mag pipeline, the nf-core
framework, and the individual upstream tools that were run as part of your
analysis:

- Krakau S, Straub D, Gourlé H, Gabernet G, Nahnsen S. **nf-core/mag: a
  best-practice pipeline for metagenome hybrid assembly and binning.** *NAR
  Genomics and Bioinformatics* (2022) 4(1):lqac007.
  doi:[10.1093/nargab/lqac007](https://doi.org/10.1093/nargab/lqac007)
- Ewels PA, Peltzer A, Fillinger S, Patel H, Alneberg J, Wilm A, Garcia MU, Di
  Tommaso P, Nahnsen S. **The nf-core framework for community-curated
  bioinformatics pipelines.** *Nature Biotechnology* (2020) 38:276-278.
  doi:[10.1038/s41587-020-0439-x](https://doi.org/10.1038/s41587-020-0439-x)
- A specific pipeline release can also be cited via Zenodo:
  doi:[10.5281/zenodo.3589527](https://doi.org/10.5281/zenodo.3589527)

For the individual tools listed above, please cite the upstream pipeline; see
the Citations section at <https://nf-co.re/mag> for the full list of tool
references and their respective DOIs.
