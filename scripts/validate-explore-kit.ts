/**
 * Validate Explore kits (explore/kits/<id>/) against the app's kit contract.
 *
 * Usage:
 *   npx tsx scripts/validate-explore-kit.ts                  # every kit under explore/kits
 *   npx tsx scripts/validate-explore-kit.ts taxon-composition explore/kits/table-summary
 *
 * Checks, per kit:
 *   - kit.json parses and matches KitSchema (src/lib/explore/kits/schema.ts)
 *   - the manifest id equals the directory name
 *   - the entrypoint exists and the named environment spec exists
 *   - README.md exists and has a "## Citation" heading
 *   - test-data/inputs.json exists, every non-optional kit input is attached,
 *     the referenced TSV + schema files exist and contain the columns that the
 *     required roles map to
 *   - test-data/expected.json exists and lists the artifacts the kit must produce
 *
 * Exits 1 when any kit has an error.
 */
import fs from "fs";
import path from "path";
import { KitSchema, type KitManifest } from "../src/lib/explore/kits/schema";

type Level = "error" | "warning";

interface Issue {
  level: Level;
  kitId: string;
  message: string;
  file?: string;
}

interface KitResult {
  kitId: string;
  dir: string;
  issues: Issue[];
}

const ARTIFACT_KINDS = new Set(["figure", "table", "report"]);
const ARTIFACT_FORMATS = new Set(["plotly-json", "png", "svg", "html", "tsv", "md"]);
const CITATION_HEADING = /^##\s+Citation\s*$/m;

const repoRoot = process.cwd();
const kitsRoot = path.join(repoRoot, "explore", "kits");
const environmentsRoot = path.join(repoRoot, "explore", "environments");

function readJsonFile(file: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relative(file: string): string {
  const rel = path.relative(repoRoot, file);
  return rel.startsWith("..") ? file : rel || ".";
}

function resolveKitDirs(args: string[]): string[] {
  if (args.length === 0) {
    if (!fs.existsSync(kitsRoot)) return [];
    return fs
      .readdirSync(kitsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
      .map((entry) => path.join(kitsRoot, entry.name))
      .sort();
  }
  return args.map((arg) => {
    const asPath = path.resolve(arg);
    if (fs.existsSync(path.join(asPath, "kit.json"))) return asPath;
    const asId = path.join(kitsRoot, arg);
    if (fs.existsSync(path.join(asId, "kit.json"))) return asId;
    return asPath;
  });
}

function readTsvHeader(file: string): string[] | null {
  try {
    const content = fs.readFileSync(file, "utf8");
    const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.split("\t").map((key) => key.trim()).filter((key) => key.length > 0);
  } catch {
    return null;
  }
}

function readSchemaColumns(file: string): string[] | { error: string } {
  const parsed = readJsonFile(file);
  if ("error" in parsed) return { error: `schema file is not valid JSON: ${parsed.error}` };
  const document = parsed.value;
  const inner = isRecord(document) && isRecord(document.schema) ? document.schema : document;
  const columns = isRecord(inner) ? inner.columns : undefined;
  if (!Array.isArray(columns)) return { error: 'schema file has no "schema.columns" array' };
  const keys: string[] = [];
  for (const column of columns) {
    if (!isRecord(column) || typeof column.key !== "string") return { error: "schema column without a string key" };
    keys.push(column.key);
  }
  return keys;
}

function validateTestData(kitId: string, dir: string, manifest: KitManifest, issues: Issue[]): void {
  const testDataDir = path.join(dir, "test-data");
  const inputsFile = path.join(testDataDir, "inputs.json");
  const push = (level: Level, message: string, file?: string) => issues.push({ level, kitId, message, file: file ? relative(file) : undefined });

  if (!fs.existsSync(inputsFile)) {
    push("error", "test-data/inputs.json is missing", inputsFile);
  } else {
    const parsed = readJsonFile(inputsFile);
    if ("error" in parsed) {
      push("error", `test-data/inputs.json is not valid JSON: ${parsed.error}`, inputsFile);
    } else if (!isRecord(parsed.value) || !isRecord(parsed.value.inputs)) {
      push("error", 'test-data/inputs.json must be an object with an "inputs" object', inputsFile);
    } else {
      const document = parsed.value;
      const attached = document.inputs as Record<string, unknown>;
      if (typeof document.outputDir === "string") {
        const outputDir = document.outputDir;
        if (path.isAbsolute(outputDir) || outputDir.split(/[\\/]/).includes("..") || outputDir === "inputs") {
          push("error", `test-data/inputs.json: outputDir "${outputDir}" must be a relative directory inside the run and not "inputs"`, inputsFile);
        }
      }
      if (!isRecord(document.run)) push("warning", 'test-data/inputs.json has no "run" object', inputsFile);
      if (!isRecord(document.curation) || !Array.isArray(document.curation.lists)) {
        push("warning", 'test-data/inputs.json has no "curation.lists" array', inputsFile);
      }
      const declared = new Map(manifest.inputs.map((input) => [input.alias, input] as const));
      for (const alias of Object.keys(attached)) {
        if (!declared.has(alias)) push("warning", `test-data/inputs.json attaches "${alias}", which kit.json does not declare`, inputsFile);
      }
      for (const input of manifest.inputs) {
        const entry = attached[input.alias];
        if (entry === undefined) {
          if (!input.optional) push("error", `test-data/inputs.json does not attach required input "${input.alias}"`, inputsFile);
          continue;
        }
        if (!isRecord(entry)) {
          push("error", `test-data/inputs.json: entry for "${input.alias}" must be an object`, inputsFile);
          continue;
        }
        const tablePath = typeof entry.path === "string" ? path.join(testDataDir, entry.path) : null;
        const schemaPath = typeof entry.schemaPath === "string" ? path.join(testDataDir, entry.schemaPath) : null;
        if (!tablePath) push("error", `test-data input "${input.alias}" has no "path"`, inputsFile);
        else if (!fs.existsSync(tablePath)) push("error", `test-data input "${input.alias}": table file not found`, tablePath);
        if (!schemaPath) push("error", `test-data input "${input.alias}" has no "schemaPath"`, inputsFile);
        else if (!fs.existsSync(schemaPath)) push("error", `test-data input "${input.alias}": schema file not found`, schemaPath);

        if (input.tableKind && entry.tableKind !== input.tableKind) {
          push("warning", `test-data input "${input.alias}" has tableKind ${JSON.stringify(entry.tableKind ?? null)}, kit expects "${input.tableKind}"`, inputsFile);
        }

        const header = tablePath && fs.existsSync(tablePath) ? readTsvHeader(tablePath) : null;
        if (tablePath && fs.existsSync(tablePath) && (!header || header.length === 0)) {
          push("error", `test-data input "${input.alias}": table file has no header row`, tablePath);
        }
        let schemaKeys: string[] | null = null;
        if (schemaPath && fs.existsSync(schemaPath)) {
          const columns = readSchemaColumns(schemaPath);
          if ("error" in columns) push("error", `test-data input "${input.alias}": ${columns.error}`, schemaPath);
          else schemaKeys = columns;
        }
        if (header && schemaKeys) {
          const headerSet = new Set(header);
          const missingInSchema = header.filter((key) => !schemaKeys!.includes(key));
          const missingInTable = schemaKeys.filter((key) => !headerSet.has(key));
          if (missingInSchema.length) push("warning", `test-data input "${input.alias}": table columns not in schema: ${missingInSchema.join(", ")}`, schemaPath!);
          if (missingInTable.length) push("warning", `test-data input "${input.alias}": schema columns not in table: ${missingInTable.join(", ")}`, tablePath!);
        }

        const roles = isRecord(entry.roles) ? entry.roles : {};
        if (!isRecord(entry.roles)) push("error", `test-data input "${input.alias}" has no "roles" object`, inputsFile);
        for (const role of input.requiredRoles) {
          const column = roles[role];
          if (typeof column !== "string" || !column) {
            push("error", `test-data input "${input.alias}": required role "${role}" is not mapped to a column`, inputsFile);
            continue;
          }
          if (header && !header.includes(column)) push("error", `test-data input "${input.alias}": role "${role}" maps to "${column}", which is not a column of the table`, tablePath!);
          if (schemaKeys && !schemaKeys.includes(column)) push("error", `test-data input "${input.alias}": role "${role}" maps to "${column}", which is not in the schema`, schemaPath!);
        }
        for (const [role, column] of Object.entries(roles)) {
          if (input.requiredRoles.includes(role)) continue;
          if (typeof column !== "string" || !column) continue;
          if (header && !header.includes(column)) push("error", `test-data input "${input.alias}": role "${role}" maps to "${column}", which is not a column of the table`, tablePath!);
        }
        if (typeof entry.rowCount === "number" && tablePath && fs.existsSync(tablePath)) {
          const lines = fs.readFileSync(tablePath, "utf8").split(/\r?\n/).filter((line) => line.length > 0);
          const rows = Math.max(0, lines.length - 1);
          if (rows !== entry.rowCount) push("warning", `test-data input "${input.alias}": rowCount ${entry.rowCount} but the table has ${rows} rows`, tablePath);
        }
      }
    }
  }

  const expectedFile = path.join(testDataDir, "expected.json");
  if (!fs.existsSync(expectedFile)) {
    push("error", "test-data/expected.json is missing", expectedFile);
    return;
  }
  const expected = readJsonFile(expectedFile);
  if ("error" in expected) {
    push("error", `test-data/expected.json is not valid JSON: ${expected.error}`, expectedFile);
    return;
  }
  if (!isRecord(expected.value) || !Array.isArray(expected.value.artifacts)) {
    push("error", 'test-data/expected.json must be an object with an "artifacts" array', expectedFile);
    return;
  }
  const declaredOutputs = new Map(manifest.outputs.map((output) => [output.name, output] as const));
  const coveredOutputs = new Set<string>();
  if (expected.value.artifacts.length === 0) push("error", "test-data/expected.json lists no artifacts", expectedFile);
  for (const artifact of expected.value.artifacts) {
    if (!isRecord(artifact) || typeof artifact.name !== "string" || typeof artifact.kind !== "string" || typeof artifact.format !== "string") {
      push("error", "test-data/expected.json: every artifact needs string name, kind and format", expectedFile);
      continue;
    }
    if (!ARTIFACT_KINDS.has(artifact.kind)) push("error", `test-data/expected.json: artifact "${artifact.name}" has unknown kind "${artifact.kind}"`, expectedFile);
    if (!ARTIFACT_FORMATS.has(artifact.format)) push("error", `test-data/expected.json: artifact "${artifact.name}" has unknown format "${artifact.format}"`, expectedFile);
    const declared = declaredOutputs.get(artifact.name);
    if (!declared) push("warning", `test-data/expected.json: artifact "${artifact.name}" is not declared in kit.json outputs`, expectedFile);
    else if (declared.kind !== artifact.kind) push("error", `test-data/expected.json: artifact "${artifact.name}" has kind "${artifact.kind}" but kit.json declares "${declared.kind}"`, expectedFile);
    coveredOutputs.add(artifact.name);
  }
  for (const output of manifest.outputs) {
    if (!coveredOutputs.has(output.name)) push("warning", `declared output "${output.name}" is not covered by test-data/expected.json`, expectedFile);
  }
  if (expected.value.metrics !== undefined && !isRecord(expected.value.metrics)) {
    push("error", 'test-data/expected.json: "metrics" must be an object', expectedFile);
  }
  if (!fs.existsSync(path.join(testDataDir, "test_kit.py"))) push("warning", "test-data/test_kit.py is missing (kit has no self-test)", path.join(testDataDir, "test_kit.py"));
}

function validateKit(dir: string): KitResult {
  const dirName = path.basename(dir);
  const issues: Issue[] = [];
  let kitId = dirName;
  const push = (level: Level, message: string, file?: string) => issues.push({ level, kitId, message, file: file ? relative(file) : undefined });

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    push("error", "kit directory not found", dir);
    return { kitId, dir, issues };
  }
  const manifestFile = path.join(dir, "kit.json");
  if (!fs.existsSync(manifestFile)) {
    push("error", "kit.json is missing", manifestFile);
    return { kitId, dir, issues };
  }
  const raw = readJsonFile(manifestFile);
  if ("error" in raw) {
    push("error", `kit.json is not valid JSON: ${raw.error}`, manifestFile);
    return { kitId, dir, issues };
  }
  const parsed = KitSchema.safeParse(raw.value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const location = issue.path.map((segment) => String(segment)).join(".") || "(root)";
      push("error", `kit.json: ${location}: ${issue.message}`, manifestFile);
    }
    return { kitId, dir, issues };
  }
  const manifest = parsed.data;
  kitId = manifest.id;
  for (const issue of issues) issue.kitId = kitId;

  if (manifest.id !== dirName) push("error", `kit id "${manifest.id}" does not match its directory name "${dirName}"`, manifestFile);

  const entrypoint = path.join(dir, manifest.entrypoint);
  if (!fs.existsSync(entrypoint) || !fs.statSync(entrypoint).isFile()) {
    push("error", `entrypoint "${manifest.entrypoint}" not found`, entrypoint);
  } else {
    const extension = path.extname(manifest.entrypoint).toLowerCase();
    if (manifest.language === "python" && extension !== ".py") push("warning", `entrypoint "${manifest.entrypoint}" is not a .py file for a python kit`, entrypoint);
    if (manifest.language === "r" && extension !== ".r") push("warning", `entrypoint "${manifest.entrypoint}" is not an .R file for an r kit`, entrypoint);
    if (fs.statSync(entrypoint).size === 0) push("error", `entrypoint "${manifest.entrypoint}" is empty`, entrypoint);
  }

  const environmentSpec = [".yml", ".yaml"].map((extension) => path.join(environmentsRoot, `${manifest.environment}${extension}`)).find((file) => fs.existsSync(file));
  if (!environmentSpec) push("error", `environment "${manifest.environment}" has no spec under explore/environments`, path.join(environmentsRoot, `${manifest.environment}.yml`));

  const readmeFile = path.join(dir, "README.md");
  if (!fs.existsSync(readmeFile)) {
    push("error", "README.md is missing", readmeFile);
  } else if (!CITATION_HEADING.test(fs.readFileSync(readmeFile, "utf8"))) {
    push("error", 'README.md has no "## Citation" heading', readmeFile);
  }
  if (!manifest.citation) push("warning", 'kit.json has no "citation" field', manifestFile);
  if (manifest.outputs.length === 0) push("warning", "kit.json declares no outputs", manifestFile);
  const seenOutputs = new Set<string>();
  for (const output of manifest.outputs) {
    if (seenOutputs.has(output.name)) push("error", `kit.json declares output "${output.name}" twice`, manifestFile);
    seenOutputs.add(output.name);
  }
  const seenAliases = new Set<string>();
  for (const input of manifest.inputs) {
    if (seenAliases.has(input.alias)) push("error", `kit.json declares input alias "${input.alias}" twice`, manifestFile);
    seenAliases.add(input.alias);
    const overlap = input.requiredRoles.filter((role) => input.optionalRoles.includes(role));
    if (overlap.length) push("warning", `input "${input.alias}" lists ${overlap.join(", ")} as both required and optional`, manifestFile);
  }

  validateTestData(kitId, dir, manifest, issues);
  return { kitId, dir, issues };
}

function run(): number {
  const kitDirs = resolveKitDirs(process.argv.slice(2));
  if (kitDirs.length === 0) {
    console.error(`No kits found under ${relative(kitsRoot)}`);
    return 1;
  }
  const results = kitDirs.map(validateKit);
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    for (const issue of result.issues) {
      if (issue.level === "error") errors += 1;
      else warnings += 1;
      const prefix = issue.level === "error" ? "ERROR" : "WARN";
      const location = issue.file ? ` (${issue.file})` : "";
      console.log(`[${prefix}] ${issue.kitId}: ${issue.message}${location}`);
    }
  }
  for (const result of results) {
    const kitErrors = result.issues.filter((issue) => issue.level === "error").length;
    console.log(`${kitErrors === 0 ? "ok  " : "FAIL"} ${result.kitId} (${relative(result.dir)})`);
  }
  console.log(`Checked ${results.length} kit(s): ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

try {
  process.exit(run());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
