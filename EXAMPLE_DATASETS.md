# Example datasets and CI provenance

SeqDesk exposes three different kinds of example data. They have different
purposes and must not be described as interchangeable.

## Data available to evaluators

| Dataset | How to access it | What it contains | File status | Intended use |
| --- | --- | --- | --- | --- |
| Hosted demo workspace | Open [demo.seqdesk.org](https://demo.seqdesk.org), using `/demo` for the researcher view or `/demo/admin` for the facility-admin view | Pre-populated orders, studies, samples, configurable metadata, read records, and inspectable example pipeline results | Safe preview paths and bundled reports; facility-admin pages are read-only, and downloads, pipeline execution, and external ENA submission are disabled | Browse researcher workflows and inspect facility administration without installing SeqDesk |
| Deterministic local fixture | **Admin → Settings → Demo data**, or `seqdesk demo-data install` after `seqdesk storage configure …` | Two studies, four orders, samples, order/study metadata, read rows, and deterministic short- and long-read FASTQ fixtures | Synthetic gzipped FASTQ files are written below the configured storage path | Test local metadata, file discovery, pipeline selection, screenshots, and demos |
| Public ENA examples | Loaded only by the named example-data/CI seed paths | Real public reads plus source and normalized sequencing provenance | Real downloaded FASTQ files with accessions below | Opt-in integration and pipeline acceptance tests; not installed by `seqdesk demo-data` |

The local fixture is idempotent and scoped to its facility-administrator owner.
`seqdesk demo-data remove` removes only that fixture after guarding linked
pipeline runs, ENA history, and its remembered storage path. It never presents
the synthetic reads as scientific data.

## Public-read sample manifest

The acceptance fixtures select a small, stable subset rather than downloading
an entire project.

| SeqDesk order | Source project | Assay represented in SeqDesk | Instrument | Selected samples and run accessions |
| --- | --- | --- | --- | --- |
| `DEV-MOUSE-PRJDB6165-001` | [PRJDB6165](https://www.ebi.ac.uk/ena/browser/view/PRJDB6165) | PCR amplicon sequencing of the 16S V3–V4 region | Illumina MiSeq | `MGB-01` `DRR099973`; `MGB-02` `DRR099974`; `MGB-03` `DRR099975`; `MGB-04` `DRR099976`; `MGB-05` `DRR099977`; `MGB-06` `DRR099978`; `MGB-07` `DRR099979`; `MGB-08` `DRR099980` |
| `DEV-HUMAN-PRJEB54724-001` | [PRJEB54724](https://www.ebi.ac.uk/ena/browser/view/PRJEB54724) | Paired-end WGS metagenomics | Illumina MiSeq | `HGM-01` `ERR10009592`; `HGM-02` `ERR10009593`; `HGM-03` `ERR10009594`; `HGM-05` `ERR10009595`; `HGM-08` `ERR10009590`; `HGM-09` `ERR10009591`; `HGM-10` `ERR10009596` |
| `DEV-HUMAN-PRJEB54724-002` | [PRJEB54724](https://www.ebi.ac.uk/ena/browser/view/PRJEB54724) | Paired-end WGS metagenomics | NextSeq 550 | `HGM-04` `ERR10009610`; `HGM-06` `ERR10009623`; `HGM-07` `ERR10009639`; `HGM-11` `ERR10009608`; `HGM-12` `ERR10009632` |

For PRJDB6165, ENA's run/library metadata declares `library_strategy=WGS`, while
the [associated publication](https://www.nature.com/articles/s41598-017-14260-9)
describes a 16S V3–V4 PCR amplicon library sequenced on MiSeq.
SeqDesk therefore stores the scientific assay as amplicon sequencing and
retains the conflicting source declaration in explicit provenance fields; it
does not silently rewrite or discard the source value.

## What runs continuously

| Input | Pipelines/path | Trigger and acceptance meaning |
| --- | --- | --- |
| Small deterministic synthetic reads | Required public order/study workflows: Simulate Reads, checksum, FastQC, Study Demo Report, and a reduced nf-core/mag wiring smoke | Pull requests and `main` changes. The reduced MAG smoke proves packaging and application integration; it is not a full biological MAG analysis. |
| Small deterministic synthetic reads | Private core matrix: `fastq-checksum`, `fastqc`, `multiqc`, `nanoplot`, `reads-qc`, `simulate-reads`, and `study-demo-report`, locally and through real outer Slurm, plus an installed-app matrix | Mirrored `main` commits and manual dispatch. The public mirror result must wait for the matching private commit; only a green pair is evidence of this acceptance gate. |
| Mouse PRJDB6165 selection above | `fastq-checksum`, FastQC, `reads-qc`, and Study Demo Report | Manual opt-in in the private Slurm workflow. The runs are additional, continue-on-error diagnostics and are not part of the required `main` gate. |
| Human PRJEB54724 selections above | Kraken2/Bracken on both instrument-specific orders; explicitly requested SubMG/MEGAHIT read-and-assembly submission for the shared study | Manual opt-in. Kraken2/Bracken needs the runner database; the SubMG path also needs ENA test credentials and fails closed if MEGAHIT does not produce a valid assembly. |
| nf-core/mag `test_minigut` public test pair (`DEV-MAG-ILMN-001`) | Reduced MAG/MEGAHIT assembly smoke; optionally reused for read-cleaning diagnostics | Manual extended Alma workflow and reduced public wiring checks. It is a tiny packaging/integration fixture, not a full biological MAG analysis. |
| Five-sample Gemma ONT profile fixture (`DEV-GEMMA-ONT-001`) | FastQC, checksum, Study Demo Report, and MetaxPath | Manual private hosted-profile workflow. Its gated source is supplied by the CI install profile; it is not one of the public ENA selections above. |
| Deterministic host/microbial spike (`DEV-RC-SPIKE-001`) | Read-cleaning contamination-removal count | Manual private extension, conditional on a staged Kraken2 database and a sufficiently large node. |

Optional MAG and MetaxPath wrapper legs report `SKIPPED` when their pipeline is
disabled or unavailable. They report `OK` only after recording and validating a
real Slurm `PipelineRun`; a clean command exit without such a run is not a pass.
For SubMG, a real-data assembly path requires successful MEGAHIT output and
fails closed if no usable assembly is produced. Synthetic assembly fixtures are
explicitly labelled and never substituted for a claimed real assembly.
