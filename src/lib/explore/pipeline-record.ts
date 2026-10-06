/**
 * What a pipeline says about itself beyond running (identity sheets 96–97): the Methods sentence it is described by,
 * the papers to cite for it and for each tool it runs, the numbers that compare two of its versions, whether it can
 * add samples to its tables without redoing the others, which of its stages work sample by sample, how its quality
 * is judged, where its changelog lives, and what data it is for (goals, reads, tables) for the finder.
 *
 * Where it comes from, first wins per field:
 *   1. the package manifest (optional fields `methods`, `citations`, `compare`, `incremental`, `merge`, `perSample`,
 *      `qc`, `changelog`, `goals`, `fit`) and definition steps flagged `perSample: true`;
 *   2. the store's registry entry (`goals`, `inputs`, `outputs`, `changelog`, `citation`, …) for pipelines that are not
 *      installed;
 *   3. what SeqDesk knows of the pipelines it ships and of the common nf-core ones (RECORD_HINTS below).
 * A pipeline nothing describes says so ("not described yet"); nothing is guessed.
 */
import { getPackage } from "@/lib/pipelines/package-loader";

export type ReadsKind = "amplicon" | "shotgun" | "long" | "any";
export type CitationKind = "pipeline" | "tool" | "framework" | "reference";

export interface PipelineCitation {
  id: string;
  kind: CitationKind;
  /** The tool or database it is cited for ("DADA2", "SILVA"); null for the pipeline itself. */
  tool: string | null;
  /** "Callahan et al. 2016" — the short form the step shows. */
  short: string;
  /** The full reference as a Methods section or a Library entry writes it. */
  text: string;
  doi: string | null;
  url: string | null;
}

export interface PipelineCompareMetric {
  id: string;
  label: string;
  /** rows / columns: of a table output · qc-pass: samples passing the quality line · top-features: the most abundant
   *  features of a table, compared as a set. */
  kind: "rows" | "columns" | "qc-pass" | "top-features";
  output: string | null;
  column?: string | null;
  top?: number | null;
}

export interface PipelineQcMetric {
  /** The column of the quality table (exact, or a column that ends with it: "total_sequences"). */
  column: string;
  label: string;
  min?: number | null;
  max?: number | null;
  unit?: string | null;
}

export interface PipelineQcSpec {
  /** The manifest output that is the quality table (qc_summary, summary). */
  output: string;
  sampleColumn: string | null;
  metrics: PipelineQcMetric[];
}

export interface PipelineIncremental {
  allowed: boolean;
  /** How each table output takes the new samples: "rows" appends them (one row or column per sample). */
  merge: Record<string, "rows">;
  /** Why not, in the pipeline's words ("DADA2 learns errors from all samples together …"). */
  reason: string | null;
}

export interface PipelineFitSpec {
  goals: string[];
  reads: { kind: ReadsKind; layouts: Array<"paired" | "single">; soft: boolean } | null;
  outputs: Array<{ name: string; tableKind: string | null }>;
  /** What question it answers, in a few words ("Which taxa, how much"). */
  answers: string | null;
}

export interface PipelineRecord {
  methods: { template: string } | null;
  citations: PipelineCitation[];
  compare: PipelineCompareMetric[];
  incremental: PipelineIncremental;
  perSample: { stages: string[]; processes: string[] };
  qc: PipelineQcSpec | null;
  /** A URL, `{version}` filled with the version the notice is about. */
  changelog: string | null;
  /** null: the pipeline does not describe what it fits ("not described yet"). */
  fit: PipelineFitSpec | null;
  /** Where the description came from. */
  source: "manifest" | "registry" | "seqdesk" | null;
}

/** Registry (store) fields a pipeline that is not installed may carry; all optional. */
export interface RegistryRecordFields {
  goals?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  changelog?: unknown;
  citation?: unknown;
  citations?: unknown;
  methods?: unknown;
  answers?: unknown;
  incremental?: unknown;
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

const cite = (id: string, kind: CitationKind, tool: string | null, short: string, text: string, doi: string | null, url: string | null = null): PipelineCitation => ({ id, kind, tool, short, text, doi, url: url ?? (doi ? `https://doi.org/${doi}` : null) });

export const CITATIONS = {
  nfcore: cite("nf-core", "framework", "nf-core", "Ewels et al. 2020", "Ewels PA, Peltzer A, Fillinger S, et al. The nf-core framework for community-curated bioinformatics pipelines. Nat Biotechnol. 2020;38(3):276–278.", "10.1038/s41587-020-0439-x"),
  nextflow: cite("nextflow", "framework", "Nextflow", "Di Tommaso et al. 2017", "Di Tommaso P, Chatzou M, Floden EW, et al. Nextflow enables reproducible computational workflows. Nat Biotechnol. 2017;35(4):316–319.", "10.1038/nbt.3820"),
  fastqc: cite("fastqc", "tool", "FastQC", "Andrews 2010", "Andrews S. FastQC: a quality control tool for high throughput sequence data. Babraham Bioinformatics; 2010.", null, "https://www.bioinformatics.babraham.ac.uk/projects/fastqc/"),
  multiqc: cite("multiqc", "tool", "MultiQC", "Ewels et al. 2016", "Ewels P, Magnusson M, Lundin S, Käller M. MultiQC: summarize analysis results for multiple tools and samples in a single report. Bioinformatics. 2016;32(19):3047–3048.", "10.1093/bioinformatics/btw354"),
  ampliseq: cite("ampliseq", "pipeline", null, "Straub et al. 2020", "Straub D, Blackwell N, Langarica-Fuentes A, et al. Interpretations of environmental microbial community studies are biased by the selected 16S rRNA (gene) amplicon sequencing pipeline. Front Microbiol. 2020;11:550420.", "10.3389/fmicb.2020.550420"),
  dada2: cite("dada2", "tool", "DADA2", "Callahan et al. 2016", "Callahan BJ, McMurdie PJ, Rosen MJ, et al. DADA2: high-resolution sample inference from Illumina amplicon data. Nat Methods. 2016;13(7):581–583.", "10.1038/nmeth.3869"),
  cutadapt: cite("cutadapt", "tool", "Cutadapt", "Martin 2011", "Martin M. Cutadapt removes adapter sequences from high-throughput sequencing reads. EMBnet.journal. 2011;17(1):10–12.", "10.14806/ej.17.1.200"),
  silva: cite("silva", "reference", "SILVA", "Quast et al. 2013", "Quast C, Pruesse E, Yilmaz P, et al. The SILVA ribosomal RNA gene database project: improved data processing and web-based tools. Nucleic Acids Res. 2013;41(D1):D590–D596.", "10.1093/nar/gks1219"),
  kraken2: cite("kraken2", "tool", "Kraken 2", "Wood et al. 2019", "Wood DE, Lu J, Langmead B. Improved metagenomic analysis with Kraken 2. Genome Biol. 2019;20:257.", "10.1186/s13059-019-1891-0"),
  bracken: cite("bracken", "tool", "Bracken", "Lu et al. 2017", "Lu J, Breitwieser FP, Thielen P, Salzberg SL. Bracken: estimating species abundance in metagenomics data. PeerJ Comput Sci. 2017;3:e104.", "10.7717/peerj-cs.104"),
  metaphlan: cite("metaphlan", "pipeline", "MetaPhlAn", "Blanco-Míguez et al. 2023", "Blanco-Míguez A, Beghini F, Cumbo F, et al. Extending and improving metagenomic taxonomic profiling with uncharacterized species using MetaPhlAn 4. Nat Biotechnol. 2023;41:1633–1644.", "10.1038/s41587-023-01688-w"),
  mag: cite("mag", "pipeline", null, "Krakau et al. 2022", "Krakau S, Straub D, Gourlé H, Gabernet G, Nahnsen S. nf-core/mag: a best-practice pipeline for metagenome hybrid assembly and binning. NAR Genom Bioinform. 2022;4(1):lqac007.", "10.1093/nargab/lqac007"),
  seqkit: cite("seqkit", "tool", "SeqKit", "Shen et al. 2016", "Shen W, Le S, Li Y, Hu F. SeqKit: a cross-platform and ultrafast toolkit for FASTA/Q file manipulation. PLoS One. 2016;11(10):e0163962.", "10.1371/journal.pone.0163962"),
  nanoplot: cite("nanoplot", "tool", "NanoPlot", "De Coster et al. 2018", "De Coster W, D’Hert S, Schultz DT, Cruts M, Van Broeckhoven C. NanoPack: visualizing and processing long-read sequencing data. Bioinformatics. 2018;34(15):2666–2669.", "10.1093/bioinformatics/bty149"),
  fastp: cite("fastp", "tool", "fastp", "Chen et al. 2018", "Chen S, Zhou Y, Chen Y, Gu J. fastp: an ultra-fast all-in-one FASTQ preprocessor. Bioinformatics. 2018;34(17):i884–i890.", "10.1093/bioinformatics/bty560"),
} as const;

// ---------------------------------------------------------------------------
// What SeqDesk knows of the pipelines it ships and of the common nf-core ones
// ---------------------------------------------------------------------------

type Hint = {
  methods?: string;
  citations?: PipelineCitation[];
  compare?: PipelineCompareMetric[];
  incremental?: Partial<PipelineIncremental> & { allowed: boolean };
  perSample?: string[];
  qc?: PipelineQcSpec;
  changelog?: string;
  fit?: Partial<PipelineFitSpec> & { reads: PipelineFitSpec["reads"] };
};

const ONE_RUN = "This pipeline makes its tables from all samples together, so they are made again in one run.";
const reads = (kind: ReadsKind, extra: { soft?: boolean; layouts?: Array<"paired" | "single"> } = {}) => ({ kind, layouts: extra.layouts ?? ["paired", "single"] as Array<"paired" | "single">, soft: extra.soft ?? false });

export const RECORD_HINTS: Record<string, Hint> = {
  fastqc: {
    methods: "Read quality was checked per sample with {pipeline} {version} and ({samples} samples).",
    citations: [CITATIONS.fastqc],
    compare: [{ id: "rows", label: "Samples in the summary", kind: "rows", output: "summary" }, { id: "qc", label: "Samples passing the quality line", kind: "qc-pass", output: "summary" }],
    incremental: { allowed: true, merge: { summary: "rows" } },
    perSample: ["FastQC", "FASTQC"],
    qc: { output: "summary", sampleColumn: "sample_id", metrics: [{ column: "r1_read_count", label: "reads", min: 10000, unit: "reads" }] },
    fit: { goals: ["Read quality"], reads: reads("any"), outputs: [{ name: "fastqc_summary", tableKind: "sample-summary" }], answers: "Are the reads good enough" },
  },
  "reads-qc": {
    methods: "Read statistics were computed per read file with SeqKit ({pipeline} {version}, {samples} samples).",
    citations: [CITATIONS.seqkit],
    incremental: { allowed: true, merge: { summary_tsv: "rows" } },
    perSample: ["SEQKIT_STATS", "Read statistics"],
    qc: { output: "summary_tsv", sampleColumn: "sample_id", metrics: [{ column: "num_reads", label: "reads", min: 10000, unit: "reads" }] },
    fit: { goals: ["Read quality"], reads: reads("any"), outputs: [{ name: "read_stats", tableKind: "sample-summary" }], answers: "How many reads, how good" },
  },
  multiqc: { citations: [CITATIONS.multiqc], fit: { goals: ["Read quality"], reads: reads("any"), outputs: [], answers: "One report for all quality checks" } },
  nanoplot: {
    citations: [CITATIONS.nanoplot], incremental: { allowed: true, merge: {} }, perSample: ["NANOPLOT", "NanoPlot"],
    fit: { goals: ["Read quality"], reads: reads("long"), outputs: [], answers: "Are the long reads good enough" },
  },
  "read-cleaning": {
    citations: [CITATIONS.fastp, CITATIONS.kraken2], incremental: { allowed: true, merge: {} }, perSample: ["FASTP", "Trimming", "Host removal"],
    fit: { goals: ["Clean reads"], reads: reads("any"), outputs: [], answers: "Reads without adapters and host" },
  },
  "kraken2-bracken": {
    methods: "Reads were assigned to taxa with Kraken 2 and abundances re-estimated with Bracken ({pipeline} {version}, {samples} samples).",
    citations: [CITATIONS.kraken2, CITATIONS.bracken],
    compare: [{ id: "rows", label: "Taxa found", kind: "rows", output: "bracken_report" }, { id: "top", label: "Top 10 species", kind: "top-features", output: "bracken_report", column: "new_est_reads", top: 10 }],
    incremental: { allowed: true, merge: { summary: "rows", bracken_report: "rows" } },
    perSample: ["KRAKEN2", "BRACKEN", "Kraken2", "Bracken"],
    fit: { goals: ["Species from shotgun reads"], reads: reads("shotgun", { soft: true }), outputs: [{ name: "bracken_species", tableKind: "taxon-profile-long" }], answers: "Which species, how many reads" },
  },
  metaphlan: {
    methods: "Taxonomic profiles were made with {pipeline} {version} from clade-specific marker genes ({samples} samples).",
    citations: [CITATIONS.metaphlan],
    incremental: { allowed: true, merge: {} },
    perSample: ["METAPHLAN", "MetaPhlAn"],
    fit: { goals: ["Species from shotgun reads"], reads: reads("shotgun"), outputs: [{ name: "metaphlan_profiles", tableKind: "taxon-profile-long" }], answers: "Which species, how abundant" },
  },
  taxprofiler: {
    citations: [CITATIONS.nfcore], incremental: { allowed: true, merge: {} },
    fit: { goals: ["Species from shotgun reads"], reads: reads("shotgun"), outputs: [], answers: "Which species, by several profilers" },
  },
  mag: {
    methods: "Metagenomes were assembled and binned with {pipeline} {version} ({samples} samples).",
    citations: [CITATIONS.mag, CITATIONS.nfcore],
    incremental: { allowed: false, reason: "Co-assembly and binning use all samples together, so the genomes are made again in one run." },
    perSample: ["Assembly"],
    changelog: "https://github.com/nf-core/mag/releases/tag/{version}",
    fit: { goals: ["Genomes from shotgun reads"], reads: reads("shotgun", { layouts: ["paired"] }), outputs: [{ name: "mag_bin_summary", tableKind: "bin-summary" }], answers: "Which genomes are in the samples" },
  },
  metaxpath: { fit: { goals: ["Species from shotgun reads"], reads: reads("shotgun"), outputs: [], answers: "Which species, with their reads" } },
  ampliseq: {
    methods: "Reads were processed with {pipeline} {version}: primers {params.primers} were removed with Cutadapt, reads truncated at {params.trunclenf} / {params.trunclenr} bp, amplicon sequence variants inferred with DADA2 and classified against {reference}, giving {output.asv_table.rows} ASVs across {samples} samples.",
    citations: [CITATIONS.ampliseq, CITATIONS.dada2, CITATIONS.cutadapt, CITATIONS.silva, CITATIONS.nfcore],
    compare: [
      { id: "asvs", label: "ASVs", kind: "rows", output: "asv_table" },
      { id: "qc", label: "Samples passing QC", kind: "qc-pass", output: "qc_summary" },
      { id: "genera", label: "Top 10 genera", kind: "top-features", output: "taxonomy", column: "Genus", top: 10 },
    ],
    incremental: { allowed: false, reason: "DADA2 learns errors from all samples together, so the tables must be made in one run." },
    perSample: ["FastQC", "Cutadapt", "FASTQC", "CUTADAPT"],
    qc: { output: "qc_summary", sampleColumn: "Sample", metrics: [{ column: "total_sequences", label: "reads", min: 10000, unit: "reads" }] },
    changelog: "https://github.com/nf-core/ampliseq/releases/tag/{version}",
    fit: { goals: ["Taxa from amplicons"], reads: reads("amplicon"), outputs: [{ name: "asv_table", tableKind: "taxon-counts" }, { name: "taxonomy", tableKind: "taxon-table" }], answers: "Which taxa, how much" },
  },
  rnaseq: { citations: [CITATIONS.nfcore], changelog: "https://github.com/nf-core/rnaseq/releases/tag/{version}" },
};

const hintOf = (pipelineId: string): Hint | null => RECORD_HINTS[pipelineId] ?? RECORD_HINTS[pipelineId.replace(/^nf-core[/-]/, "")] ?? null;

// ---------------------------------------------------------------------------
// Reading the manifest and registry fields, tolerantly
// ---------------------------------------------------------------------------

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown, max = 2000): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const strings = (value: unknown, max = 40): string[] => (Array.isArray(value) ? value.map((entry) => str(entry, 200)).filter((entry): entry is string => Boolean(entry)).slice(0, max) : []);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const READS = new Set(["amplicon", "shotgun", "long", "any"]);

function citationsOf(raw: unknown): PipelineCitation[] {
  if (typeof raw === "string" && raw.trim()) return [cite("pipeline", "pipeline", null, raw.trim().split(/[,;(]/)[0].trim().slice(0, 80), raw.trim().slice(0, 1000), /10\.\d{4,9}\/\S+/.exec(raw)?.[0].replace(/[.,;)]+$/, "") ?? null)];
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((entry, index) => {
    const value = rec(entry);
    const text = str(value.text, 1000);
    if (!text) return [];
    const kind = (["pipeline", "tool", "framework", "reference"].includes(String(value.kind)) ? value.kind : value.tool ? "tool" : "pipeline") as CitationKind;
    const doi = str(value.doi, 200);
    return [cite(str(value.id, 80) ?? `cite-${index + 1}`, kind, str(value.tool, 80), str(value.short, 80) ?? text.split(/[,.(]/)[0].slice(0, 80), text, doi, str(value.url, 500))];
  });
}

function compareOf(raw: unknown): PipelineCompareMetric[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).flatMap((entry, index) => {
    const value = rec(entry);
    const kind = String(value.kind);
    if (!["rows", "columns", "qc-pass", "top-features"].includes(kind)) return [];
    return [{ id: str(value.id, 80) ?? `metric-${index + 1}`, label: str(value.label, 120) ?? kind, kind: kind as PipelineCompareMetric["kind"], output: str(value.output, 120), column: str(value.column, 200), top: num(value.top) }];
  });
}

function qcOf(raw: unknown): PipelineQcSpec | null {
  const value = rec(raw);
  const output = str(value.output, 120);
  const metrics = (Array.isArray(value.metrics) ? value.metrics : []).slice(0, 10).flatMap((entry) => {
    const metric = rec(entry);
    const column = str(metric.column, 200);
    if (!column) return [];
    return [{ column, label: str(metric.label, 80) ?? column, min: num(metric.min), max: num(metric.max), unit: str(metric.unit, 40) }];
  });
  return output && metrics.length ? { output, sampleColumn: str(value.sampleColumn, 120), metrics } : null;
}

function incrementalOf(raw: unknown, merge: unknown): Partial<PipelineIncremental> & { allowed: boolean } | null {
  const mergeRules = (value: unknown) => Object.fromEntries(Object.entries(rec(value)).filter(([, rule]) => rule === "rows").map(([key]) => [key, "rows" as const]));
  if (typeof raw === "boolean") return { allowed: raw, merge: mergeRules(merge) };
  const value = rec(raw);
  if (typeof value.allowed !== "boolean") return null;
  return { allowed: value.allowed, merge: mergeRules(value.merge ?? merge), reason: str(value.reason, 500) };
}

function fitFrom(goals: unknown, inputs: unknown, outputs: unknown, answers: unknown): PipelineFitSpec | null {
  const input = rec(inputs);
  const readsValue = rec(input.reads ?? input);
  const kind = typeof input.reads === "string" ? input.reads : readsValue.kind;
  const layouts = strings(readsValue.layouts ?? input.layouts).filter((entry): entry is "paired" | "single" => entry === "paired" || entry === "single");
  const readsSpec = typeof kind === "string" && READS.has(kind) ? { kind: kind as ReadsKind, layouts: layouts.length ? layouts : ["paired", "single"] as Array<"paired" | "single">, soft: readsValue.soft === true || input.soft === true } : null;
  const tables = (Array.isArray(outputs) ? outputs : []).slice(0, 20).flatMap((entry) => {
    const value = typeof entry === "string" ? { name: entry } : rec(entry);
    const name = str(value.name, 120);
    return name ? [{ name, tableKind: str(value.tableKind, 80) }] : [];
  });
  const goalList = strings(goals, 10);
  if (!readsSpec && !goalList.length) return null;
  return { goals: goalList, reads: readsSpec, outputs: tables, answers: str(answers, 120) };
}

/** Stage names of the package's definition flagged `perSample: true`, with their process matchers. */
function definitionPerSample(pipelineId: string): { stages: string[]; processes: string[] } {
  const pkg = getPackage(pipelineId);
  const steps = (pkg?.definition?.steps ?? []) as Array<{ id?: string; name?: string; perSample?: unknown; processMatchers?: string[] }>;
  const flagged = steps.filter((step) => step.perSample === true);
  return { stages: flagged.flatMap((step) => [step.name, step.id].filter((value): value is string => Boolean(value))), processes: flagged.flatMap((step) => step.processMatchers ?? []) };
}

/**
 * The record of one pipeline: manifest first, then the registry entry (for store pipelines), then what SeqDesk knows.
 * `registry` is the store entry's raw fields when the pipeline is not installed here.
 */
export function pipelineRecord(pipelineId: string, registry?: RegistryRecordFields | null): PipelineRecord {
  const pkg = getPackage(pipelineId);
  const manifest = rec(pkg?.manifest);
  const reg = rec(registry);
  const local = rec(pkg?.registry);
  const hint = hintOf(pipelineId);
  const fromManifest = Boolean(manifest.methods || manifest.citations || manifest.compare || manifest.incremental !== undefined || manifest.qc || manifest.goals || manifest.fit || local.goals || local.fit);

  const template = str(rec(manifest.methods).template) ?? str(manifest.methods) ?? str(rec(reg.methods).template) ?? str(reg.methods) ?? hint?.methods ?? null;
  const citations = [...citationsOf(manifest.citations), ...(manifest.citations ? [] : citationsOf(reg.citations ?? reg.citation)), ...((manifest.citations || reg.citations || reg.citation) ? [] : hint?.citations ?? [])];
  const incremental = incrementalOf(manifest.incremental, manifest.merge) ?? incrementalOf(reg.incremental, undefined) ?? hint?.incremental ?? null;
  const fromDefinition = definitionPerSample(pipelineId);
  const perSampleList = strings(manifest.perSample, 60);
  // A package says it in its manifest (`goals`, `fit: {inputs, outputs, answers}`) or in registry.json (`goals`, `fit`).
  const ownFit = rec(manifest.fit ?? local.fit);
  const fit = fitFrom(manifest.goals ?? local.goals ?? ownFit.goals, ownFit.inputs, ownFit.outputs, ownFit.answers)
    ?? fitFrom(reg.goals, reg.inputs, reg.outputs, reg.answers)
    ?? (hint?.fit ? { goals: hint.fit.goals ?? [], reads: hint.fit.reads, outputs: hint.fit.outputs ?? [], answers: hint.fit.answers ?? null } : null);
  return {
    methods: template ? { template } : null,
    citations,
    compare: compareOf(manifest.compare).length ? compareOf(manifest.compare) : hint?.compare ?? [],
    incremental: incremental ? { allowed: incremental.allowed, merge: incremental.merge ?? {}, reason: incremental.allowed ? null : incremental.reason ?? ONE_RUN } : { allowed: false, merge: {}, reason: "This pipeline does not say that it can add samples to its tables, so they are made again in one run." },
    perSample: {
      stages: [...new Set([...fromDefinition.stages, ...perSampleList, ...(perSampleList.length || fromDefinition.stages.length ? [] : hint?.perSample ?? [])])],
      processes: [...new Set([...fromDefinition.processes, ...perSampleList.map((entry) => entry.toUpperCase())])],
    },
    qc: qcOf(manifest.qc) ?? hint?.qc ?? null,
    changelog: str(manifest.changelog, 500) ?? str(reg.changelog, 500) ?? hint?.changelog ?? (/nf-core/i.test(`${String(rec(manifest.package).provider ?? "")} ${pipelineId}`) ? `https://github.com/nf-core/${pipelineId.replace(/^nf-core[/-]/, "")}/releases/tag/{version}` : null),
    fit,
    source: fromManifest ? "manifest" : registry && Object.keys(reg).some((key) => ["goals", "inputs", "outputs", "citation", "citations", "methods"].includes(key)) ? "registry" : hint ? "seqdesk" : null,
  };
}

/** The changelog URL for a version, or null. */
export function changelogUrl(record: PipelineRecord, version: string | null | undefined): string | null {
  if (!record.changelog) return null;
  return record.changelog.includes("{version}") ? (version ? record.changelog.replace(/\{version\}/g, encodeURIComponent(version)) : null) : record.changelog;
}

/** A process name as the trace writes it ("NFCORE_AMPLISEQ:AMPLISEQ:CUTADAPT_WORKFLOW:CUTADAPT_BASIC") reduced to its last part. */
const lastPart = (process: string) => process.split(":").pop() ?? process;

/**
 * Whether a stage or a process works sample by sample, by the pipeline's own word: a manifest `perSample` entry or a
 * definition step flagged `perSample: true` (stage name, step id or one of its process matchers), else SeqDesk's
 * knowledge of the pipeline. Unknown means no: leaving one sample out mid-run is offered only where it is said.
 */
export function worksPerSample(record: PipelineRecord, stage: string | null | undefined, process?: string | null): boolean {
  const names = new Set(record.perSample.stages.map((entry) => entry.toLowerCase()));
  if (stage && names.has(stage.toLowerCase())) return true;
  if (process) {
    const last = lastPart(process).toUpperCase();
    if (record.perSample.processes.some((entry) => last === entry.toUpperCase() || last.startsWith(`${entry.toUpperCase()}_`) || entry.toUpperCase() === last.split("_")[0])) return true;
    if (names.has(last.toLowerCase())) return true;
  }
  return false;
}

/** "DADA2 works on all samples together" — why a sample cannot be left out at this stage. */
export function notPerSampleWords(stage: string | null | undefined): string {
  return `${stage ? `${stage} works` : "This stage works"} on all samples together, so one sample cannot be left out while it runs; Resume applies once it stopped.`;
}
