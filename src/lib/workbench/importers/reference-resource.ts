/**
 * Reference resources (Data > Resources): versioned reference tables that analysis steps read as inputs instead
 * of downloading annotation packages at run time. Each resource is pinned to one release of an official source,
 * downloaded with its published checksum where the source has one, and turned into one gene-set table:
 *
 *   term  name  n_genes  genes        one row per set; genes are space-separated identifiers, sorted
 *
 * The table (gene_sets.tsv) sits next to the downloaded source files in the import, with its own SHA-256, and
 * carries version, source URLs, licence and citation in the import's sourceMetadata. Imports > Use in Analysis >
 * Make table turns it into a study table like any other connector file.
 *
 *   go-bp-human            GO Biological Process, Ensembl gene ids, with ancestor propagation (GOALL), from the
 *                          Bioconductor 3.22 annotation packages org.Hs.eg.db 3.22.0 and GO.db 3.22.0 (MD5 from the
 *                          Bioconductor PACKAGES index). GO data CC BY 4.0; packages Artistic-2.0.
 *   msigdb-hallmark-human  MSigDB Hallmark gene sets 2026.1.Hs, gene symbols, from the Broad release folder.
 *                          MSigDB terms: CC BY 4.0 (Hallmark is not among the KEGG-derived exceptions).
 *   ensembl-symbol-human   Ensembl gene id -> HGNC symbol and name (gene_symbols.tsv: gene_id symbol name entrez),
 *                          from org.Hs.eg.db 3.22.0 (Bioconductor 3.22), so figures can label genes by symbol.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import { downloadRecordAssets, LOOKUP_TIMEOUT_MS, manifestEntry, SOURCE_USER_AGENT, sizeWarnings, type RecordAsset } from "./public-record-download";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const run = promisify(execFile);

export interface GeneSet { term: string; name: string; genes: string[] }

interface ResourceFile { url: string; filename: string; md5?: string; bytes?: number }

export interface ReferenceResource {
  id: string;
  title: string;
  category: "Gene sets" | "Ontologies" | "Gene annotation";
  version: string;
  organism: string;
  identifiers: string;
  sourcePage: string;
  licence: string;
  licenceUrl: string;
  citation: string;
  files: ResourceFile[];
  /** Hosts a download may be redirected to (Bioconductor serves from a mirror bucket). */
  mirrors?: RegExp[];
  /** A gene-set resource builds its sets (written as gene_sets.tsv)... */
  build?(paths: Record<string, string>, workDir: string): Promise<GeneSet[]>;
  /** ...any other resource builds its own table. */
  buildTable?(paths: Record<string, string>, workDir: string): Promise<ResourceTable>;
}

/** The table a resource installs next to its source files. */
export interface ResourceTable { file: string; suffix: string; tsv: string; rows: number; description: string; metadata: Record<string, number> }

const BIOC = "https://bioconductor.org/packages/3.22/data/annotation/src/contrib";

/** Extract one member of a .tar.gz into `dir` and return its path (system tar; the member path is fixed). */
async function untarMember(archive: string, member: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", dir, member], { timeout: 10 * 60_000 });
  const target = path.join(dir, member);
  if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) throw new Error("Unexpected archive member.");
  await fs.access(target);
  return target;
}

interface SqliteDb { prepare(sql: string): { all(): unknown[] }; close(): void }

/** node:sqlite (Node 22.5+), loaded at run time so bundlers leave it alone. */
async function sqlite(file: string): Promise<SqliteDb> {
  const load = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod = load?.("node:sqlite") as { DatabaseSync: new (file: string, options: { readOnly: boolean }) => SqliteDb } | undefined;
  if (!mod) throw new Error("Building this resource needs Node.js 22.5 or newer (node:sqlite).");
  return new mod.DatabaseSync(file, { readOnly: true });
}

/** GOALL for Biological Process (ancestor-propagated), Ensembl gene ids via org.Hs.eg.db's ensembl table. */
export async function buildGoBp(orgDb: string, goDb: string): Promise<GeneSet[]> {
  const org = await sqlite(orgDb);
  const go = await sqlite(goDb);
  try {
    const pairs = org.prepare("SELECT DISTINCT b.go_id AS term, e.ensembl_id AS gene FROM go_bp_all b JOIN ensembl e ON e._id = b._id").all() as Array<{ term: string; gene: string }>;
    const names = new Map((go.prepare("SELECT go_id, term FROM go_term WHERE ontology = 'BP'").all() as Array<{ go_id: string; term: string }>).map(row => [row.go_id, row.term]));
    const sets = new Map<string, Set<string>>();
    for (const { term, gene } of pairs) {
      if (!sets.has(term)) sets.set(term, new Set());
      sets.get(term)!.add(gene);
    }
    return [...sets.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([term, genes]) => ({ term, name: names.get(term) ?? "", genes: [...genes].sort() }));
  } finally {
    org.close();
    go.close();
  }
}

export interface GeneSymbol { gene_id: string; symbol: string; name: string; entrez: string }

/** Ensembl gene id -> symbol from org.Hs.eg.db's ensembl and gene_info tables. An Ensembl id that maps to several
 *  Entrez genes keeps the symbol of the lowest Entrez id, so every id has exactly one label. */
export async function buildEnsemblSymbols(orgDb: string): Promise<GeneSymbol[]> {
  const org = await sqlite(orgDb);
  try {
    const rows = org.prepare("SELECT e.ensembl_id AS gene_id, i.symbol AS symbol, i.gene_name AS name, g.gene_id AS entrez FROM ensembl e JOIN gene_info i ON i._id = e._id JOIN genes g ON g._id = e._id").all() as GeneSymbol[];
    return symbolTable(rows);
  } finally {
    org.close();
  }
}

/** One row per Ensembl id (lowest Entrez id wins), sorted by id. Pure. */
export function symbolTable(rows: GeneSymbol[]): GeneSymbol[] {
  const best = new Map<string, GeneSymbol>();
  for (const row of rows) {
    if (!row.gene_id || !row.symbol) continue;
    const had = best.get(row.gene_id);
    if (!had || Number(row.entrez) < Number(had.entrez)) best.set(row.gene_id, { gene_id: row.gene_id, symbol: row.symbol, name: row.name ?? "", entrez: String(row.entrez ?? "") });
  }
  return [...best.values()].sort((a, b) => a.gene_id.localeCompare(b.gene_id));
}

export function geneSymbolTsv(rows: GeneSymbol[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ");
  return ["gene_id\tsymbol\tname\tentrez", ...rows.map(row => [row.gene_id, row.symbol, row.name, row.entrez].map(clean).join("\t"))].join("\n") + "\n";
}

/** A GMT file (name, description/url, genes…) as gene sets; names read "TGF beta signaling". */
export function parseGmt(text: string): GeneSet[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [term, , ...genes] = line.split("\t");
    const name = term.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
    return { term, name, genes: [...new Set(genes.filter(Boolean))].sort() };
  }).sort((a, b) => a.term.localeCompare(b.term));
}

export function geneSetTsv(sets: GeneSet[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ");
  return ["term\tname\tn_genes\tgenes", ...sets.map(set => [clean(set.term), clean(set.name), set.genes.length, set.genes.join(" ")].join("\t"))].join("\n") + "\n";
}

export const REFERENCE_RESOURCES: ReferenceResource[] = [
  {
    id: "go-bp-human",
    title: "GO Biological Process, human (Ensembl genes)",
    category: "Ontologies",
    version: "Bioconductor 3.22: org.Hs.eg.db 3.22.0, GO.db 3.22.0 (GO 2025-07-22, Entrez Gene 2025-09-24)",
    organism: "Homo sapiens",
    identifiers: "Ensembl gene ids",
    sourcePage: "https://bioconductor.org/packages/3.22/data/annotation/html/org.Hs.eg.db.html",
    licence: "GO annotations CC BY 4.0 (geneontology.org); packages Artistic-2.0",
    licenceUrl: "https://geneontology.org/docs/go-citation-policy/",
    citation: "Gene Ontology Consortium. The Gene Ontology knowledgebase in 2023. Genetics 224(1):iyad031 (2023); Carlson M. org.Hs.eg.db: Genome wide annotation for Human. R package 3.22.0; Carlson M. GO.db: A set of annotation maps describing the entire Gene Ontology. R package 3.22.0.",
    files: [
      { url: `${BIOC}/org.Hs.eg.db_3.22.0.tar.gz`, filename: "org.Hs.eg.db_3.22.0.tar.gz", md5: "e80cac6ec018a95aea4f7530350e80a2" },
      { url: `${BIOC}/GO.db_3.22.0.tar.gz`, filename: "GO.db_3.22.0.tar.gz", md5: "5ae5557afa56227c4c9c145907b1f585" },
    ],
    mirrors: [/^https:\/\/mghp\.osn\.xsede\.org\/bir190004-bucket01\/archive\.bioconductor\.org\/packages\/3\.22\/data\/annotation\/src\/contrib\/[A-Za-z0-9._]+\.tar\.gz$/],
    async build(paths, workDir) {
      const org = await untarMember(paths["org.Hs.eg.db_3.22.0.tar.gz"], "org.Hs.eg.db/inst/extdata/org.Hs.eg.sqlite", workDir);
      const go = await untarMember(paths["GO.db_3.22.0.tar.gz"], "GO.db/inst/extdata/GO.sqlite", workDir);
      return buildGoBp(org, go);
    },
  },
  {
    id: "msigdb-hallmark-human",
    title: "MSigDB Hallmark gene sets, human (gene symbols)",
    category: "Gene sets",
    version: "MSigDB 2026.1.Hs",
    organism: "Homo sapiens",
    identifiers: "HGNC gene symbols",
    sourcePage: "https://www.gsea-msigdb.org/gsea/msigdb/human/collections.jsp#H",
    licence: "CC BY 4.0 (MSigDB licence terms; Hallmark is not among the KEGG-derived exceptions)",
    licenceUrl: "https://www.gsea-msigdb.org/gsea/msigdb_license_terms.jsp",
    citation: "Liberzon A, Birger C, Thorvaldsdóttir H, Ghandi M, Mesirov JP, Tamayo P. The Molecular Signatures Database (MSigDB) hallmark gene set collection. Cell Systems 1(6):417-425 (2015).",
    files: [{ url: "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2026.1.Hs/h.all.v2026.1.Hs.symbols.gmt", filename: "h.all.v2026.1.Hs.symbols.gmt" }],
    async build(paths) {
      return parseGmt(await fs.readFile(paths["h.all.v2026.1.Hs.symbols.gmt"], "utf8"));
    },
  },
  {
    id: "ensembl-symbol-human",
    title: "Ensembl → symbol, human (Bioconductor 3.22)",
    category: "Gene annotation",
    version: "Bioconductor 3.22: org.Hs.eg.db 3.22.0 (Entrez Gene 2025-09-24, Ensembl via NCBI gene2ensembl)",
    organism: "Homo sapiens",
    identifiers: "Ensembl gene ids → HGNC gene symbols",
    sourcePage: "https://bioconductor.org/packages/3.22/data/annotation/html/org.Hs.eg.db.html",
    licence: "Artistic-2.0 (org.Hs.eg.db); NCBI Gene data in the public domain",
    licenceUrl: "https://bioconductor.org/packages/3.22/data/annotation/html/org.Hs.eg.db.html",
    citation: "Carlson M. org.Hs.eg.db: Genome wide annotation for Human. R package 3.22.0.",
    files: [{ url: `${BIOC}/org.Hs.eg.db_3.22.0.tar.gz`, filename: "org.Hs.eg.db_3.22.0.tar.gz", md5: "e80cac6ec018a95aea4f7530350e80a2" }],
    mirrors: [/^https:\/\/mghp\.osn\.xsede\.org\/bir190004-bucket01\/archive\.bioconductor\.org\/packages\/3\.22\/data\/annotation\/src\/contrib\/[A-Za-z0-9._]+\.tar\.gz$/],
    async buildTable(paths, workDir) {
      const org = await untarMember(paths["org.Hs.eg.db_3.22.0.tar.gz"], "org.Hs.eg.db/inst/extdata/org.Hs.eg.sqlite", workDir);
      const rows = await buildEnsemblSymbols(org);
      return { file: "gene_symbols.tsv", suffix: "gene_symbols.tsv", tsv: geneSymbolTsv(rows), rows: rows.length, description: `${rows.length} Ensembl genes with their symbol`, metadata: { genes: rows.length } };
    },
  },
];

/** The gene-set table of a gene-set resource. Pure. */
export function geneSetTable(sets: GeneSet[]): ResourceTable {
  const pairs = sets.reduce((sum, set) => sum + set.genes.length, 0);
  return { file: "gene_sets.tsv", suffix: "gene_sets.tsv", tsv: geneSetTsv(sets), rows: sets.length, description: `${sets.length} sets (${pairs} gene-set pairs)`, metadata: { sets: sets.length, pairs } };
}

export const referenceResourceInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  resource: z.enum(REFERENCE_RESOURCES.map(resource => resource.id) as [string, ...string[]]),
});
type ReferenceResourceInput = z.infer<typeof referenceResourceInputSchema>;

export function getReferenceResource(id: string): ReferenceResource | null {
  return REFERENCE_RESOURCES.find(resource => resource.id === id) ?? null;
}

async function remoteSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "accept-encoding": "identity", "user-agent": SOURCE_USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    const length = Number(response.headers.get("content-length"));
    return response.ok && Number.isSafeInteger(length) && length > 0 ? length : 0;
  } catch {
    return 0;
  }
}

const allowed = (resource: ReferenceResource) => (url: string) => resource.files.some(file => file.url === url);

export const referenceResourceImporter: WorkbenchImporterProvider<ReferenceResourceInput> = {
  id: "reference-resource",
  label: "Reference resources",
  description: "Install a versioned reference table (GO Biological Process, MSigDB Hallmark, Ensembl → symbol) from its official source, with licence, citation and checksums.",
  category: "reference",
  inputSchema: referenceResourceInputSchema,
  async preflight() {
    return { ok: true, message: `Pinned releases from Bioconductor and MSigDB: ${REFERENCE_RESOURCES.map(resource => resource.id).join(", ")}.` };
  },
  async preview(input): Promise<WorkbenchImportPreview> {
    const resource = getReferenceResource(input.resource)!;
    const assets: RecordAsset[] = await Promise.all(resource.files.map(async file => ({
      url: file.url, filename: file.filename, bytes: file.bytes ?? await remoteSize(file.url), etag: file.md5 ? `md5:${file.md5}` : "", role: "source",
    })));
    const warnings = sizeWarnings(assets, resource.title);
    if (assets.some(asset => !asset.etag)) warnings.push("The source publishes no checksum for some files; SeqDesk records their SHA-256 at download.");
    return {
      providerId: "reference-resource",
      summary: { label: `${resource.title} · ${resource.version}`, totalFound: assets.length, selectedCount: assets.length, capped: false, cap: assets.length, hardMax: assets.length },
      genomes: [],
      assets,
      records: [{ id: resource.id, title: resource.title, detail: [resource.version, resource.licence].join(" · ") }],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  getCacheKey(input, preview) {
    const resource = getReferenceResource(input.resource)!;
    return buildStableRequestHash("reference-resource", { resource: resource.id, version: resource.version, assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })) });
  },
  async start(context) {
    const resource = getReferenceResource(context.input.resource);
    if (!resource) throw new Error("Unknown reference resource. Preview it again.");
    const assets = (context.preview.assets ?? []).filter(asset => allowed(resource)(asset.url));
    if (assets.length !== resource.files.length) throw new Error("The reference preview is incomplete. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: resource.title,
      assets,
      allowUrl: allowed(resource),
      allowRedirectTo: url => resource.mirrors?.some(mirror => mirror.test(url)) ?? false,
      storedFilename: asset => asset.filename.replace(/[^A-Za-z0-9._-]+/g, "_"),
      md5: asset => /^md5:([0-9a-f]{32})$/.exec(asset.etag)?.[1],
    });
    await context.update({ phase: resource.buildTable ? "Building the table" : "Building the gene-set table", progress: 96 });
    const workDir = path.join(context.storage.cacheDir, "work");
    const paths = Object.fromEntries(result.files.map(file => [file.filename, path.join(result.directory, file.storedFilename)]));
    const table = resource.buildTable ? await resource.buildTable(paths, workDir) : geneSetTable(await resource.build!(paths, workDir));
    await fs.rm(workDir, { recursive: true, force: true });
    if (!table.rows) throw new Error(`${resource.title}: the source files held no ${resource.buildTable ? "rows" : "gene sets"}.`);
    const { tsv } = table;
    const tableFile = table.file;
    await fs.writeFile(path.join(result.directory, tableFile), tsv, { mode: 0o600 });
    const bytes = Buffer.byteLength(tsv);
    const sha256 = crypto.createHash("sha256").update(tsv).digest("hex");
    const md5 = crypto.createHash("md5").update(tsv).digest("hex");
    await context.log(`Built ${tableFile}: ${table.description}, sha256 ${sha256}.`);
    const files = [
      { role: "table", filename: `${resource.id}.${table.suffix}`, storedFilename: `files/${tableFile}`, sourceUrl: resource.sourcePage, sourceVersion: resource.version, bytes, md5, sha256,
        derivedFrom: result.files.map(file => file.filename) },
      ...result.files.map(manifestEntry),
    ];
    const checksumSha256 = crypto.createHash("sha256").update(JSON.stringify(files.map(file => ({ path: file.storedFilename, sha256: file.sha256 })))).digest("hex");
    return {
      cacheKey: context.cacheKey,
      name: `${resource.title} · ${resource.version}`,
      description: `${table.description} from ${resource.files.map(file => file.filename).join(" and ")}.`,
      sourceType: "reference-resource",
      sourceMetadata: {
        source: "Reference",
        kind: "reference",
        record: resource.id,
        title: resource.title,
        detail: [resource.version, resource.licence].join(" · "),
        category: resource.category,
        version: resource.version,
        organism: resource.organism,
        identifiers: resource.identifiers,
        sourcePage: resource.sourcePage,
        sourceUrls: resource.files.map(file => file.url),
        licence: resource.licence,
        licenceUrl: resource.licenceUrl,
        citation: resource.citation,
        ...table.metadata,
        retrievedAt: new Date().toISOString(),
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files,
      },
      storagePath: result.directory,
      sizeBytes: result.sizeBytes + bytes,
      checksumSha256,
    };
  },
};
