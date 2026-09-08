# MetaPhlAn profiling

One source-neutral SeqDesk package for selected **short shotgun FASTQ reads**
from CAMI, SRA/ENA, uploaded/linked files or the facility. Supports single-end
and paired-end input. No read cleaning, assembly or ground-truth input.
Long-read support is deliberately not advertised by this first package.

## Setup

1. Open **Admin → Pipelines → Installed → Taxonomic Profiling (MetaPhlAn)**.
   This branch bundles the package; it is not yet published in the public registry.
   The Conda profile provisions MetaPhlAn **4.2.5** when the workflow runs.
2. Choose **Set up DB → Download & set up**, or **Link existing directory** for
   the declared `mpa_vJan26_CHOCOPhlAnSGB_202605` database. Setup checks both archives
   against pinned publisher MD5 checksums, extracts the required files and sets
   `metaphlanDb` and `metaphlanIndex` together. Only then enable the package.
   Local Linux/Intel or configured Linux compute is the initial
   supported execution path; macOS ARM Conda compatibility is not assumed.
3. Under sequencing data → Pipelines, select a validated read set for each
   imported sample, then select samples and start the run. Only existing active
   read records are used; download completion alone does not select them.

A run requires the metadata `.pkl` and the complete six-file **`.bt2l`**
index before invoking the tool. `--offline` and the exact index prevent update
selection. Runs never download the database themselves. The explicit setup action
downloads **47,756,625,920 bytes (44.5 GiB)**; its conservative free-space check
includes a 60 GiB extraction bound plus 1 GiB safety margin. No download was
started while implementing this feature.

Setup uses the existing admin UI, with progress and cancellation. A retry starts
fresh; cancellation removes only that attempt's temporary files. Existing
installations remain untouched, including those used by older runs. After an app
restart, an interrupted job is shown as an error and can be retried when its
previous process is known to have exited. Interrupted temporary directories and
old versions require administrator cleanup; no broad automatic deletion is done.
The database directory must be readable on the execution host (shared storage for
remote compute). Linking checks filenames, regular-file type and the exact
declared sizes, **not**
publisher archive checksums; only link trusted reference data.

The resource contract is in `manifest.json.resources`; no pipeline-name branch or
downloaded installation script is needed in SeqDesk's core. The declared archive
format is intentionally strict (ordinary file/directory tar entries only; no
links, GNU/PAX extensions, traversal or duplicated filenames).

Publisher: [index archive checksum](https://cmprod1.cibio.unitn.it/biobakery4/metaphlan_databases/bowtie2_indexes/mpa_vJan26_CHOCOPhlAnSGB_202605_bt2.md5),
[metadata archive checksum](https://cmprod1.cibio.unitn.it/biobakery4/metaphlan_databases/mpa_vJan26_CHOCOPhlAnSGB_202605.md5),
[pinned database controller](https://github.com/biobakery/MetaPhlAn/blob/4.2.5/metaphlan/utils/database_controller.py).
URLs, sizes, all 10 archive entry headers and MD5 values were checked on September 8,
2026. Range requests transferred only 6 KiB of tar headers and located every
required file, including indexes larger than 8 GiB with base-256 tar sizes. The complete
multi-gigabyte download/extraction and a real profiling run remain acceptance gates.

## Results and reproducibility

Per-sample native profile, the upstream `--CAMI_format_output` export and JSON
provenance are attached to the run. Mapping is performed once; the CAMI export
reuses the mapping output. The database index, metadata SHA-256, exact tool
version, input paths, commands and abundance-normalization policy are recorded.
Read processing labels are left untouched. Sample codes must be unique,
path-safe identifiers (up to 120 characters); pairs must have distinct filenames.

The default retains MetaPhlAn's unclassified estimate. Normalizing to classified
taxa is an explicit option. Neither setting guarantees the same abundance
definition as a reference benchmark.

## Benchmark caveats

The upstream CAMI export is not the native SGB profile: it excludes SGB-level
rows and depends on the database's taxonomic assignments. Novel species, species
groups, empty/ambiguous IDs and taxonomy changes can limit comparison to CAMI.
The `cami-opal` package therefore requires explicit sample mapping and reference
compatibility confirmation. A completed run is not proof of scientific accuracy.

Sources: [MetaPhlAn](https://github.com/biobakery/MetaPhlAn),
[pinned implementation](https://github.com/biobakery/MetaPhlAn/blob/4.2.5/metaphlan/metaphlan.py),
[upstream documentation](https://github.com/biobakery/MetaPhlAn/wiki/MetaPhlAn-4).
