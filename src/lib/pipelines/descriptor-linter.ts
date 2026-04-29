import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { ManifestSchema, type Manifest } from "./manifest-schema";

export type DescriptorLintLevel = "error" | "warning";

export interface DescriptorLintIssue {
  level: DescriptorLintLevel;
  code: string;
  message: string;
  file?: string;
}

export interface DescriptorLintResult {
  packageId: string;
  packageDir: string;
  valid: boolean;
  errors: number;
  warnings: number;
  issues: DescriptorLintIssue[];
}

function addIssue(
  issues: DescriptorLintIssue[],
  level: DescriptorLintLevel,
  code: string,
  message: string,
  file?: string
) {
  issues.push({ level, code, message, file });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readYaml(filePath: string): Promise<unknown | null> {
  try {
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolvePackagePath(packageDir: string, relativePath?: string): string | null {
  if (!relativePath) return null;
  return path.resolve(packageDir, relativePath);
}

function isLocalPipelineRef(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
}

function looksLikeFlag(value: string): boolean {
  return value === "" || value.startsWith("-") || /^[A-Za-z0-9_.-]+$/.test(value);
}

async function validateExecution(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
): Promise<void> {
  if (manifest.execution.type !== "nextflow") {
    addIssue(
      issues,
      "error",
      "execution-type",
      'execution.type must be "nextflow".',
      "manifest.json"
    );
  }

  if (isLocalPipelineRef(manifest.execution.pipeline)) {
    const pipelinePath = path.resolve(packageDir, manifest.execution.pipeline);
    if (!(await pathExists(pipelinePath))) {
      addIssue(
        issues,
        "warning",
        "local-workflow-missing",
        `Local execution.pipeline path does not exist: ${manifest.execution.pipeline}. This is OK only if a custom runner handles the package.`,
        "manifest.json"
      );
    }
  }

  for (const [key, flag] of Object.entries(manifest.execution.paramMap || {})) {
    if (!looksLikeFlag(flag)) {
      addIssue(
        issues,
        "warning",
        "param-map-flag",
        `paramMap.${key} should be a Nextflow flag, plain token, or empty SeqDesk-only mapping.`,
        "manifest.json"
      );
    }
  }

  if (
    manifest.package.id === "metaxpath" &&
    manifest.execution.paramMap?.paramsFile !== "-params-file"
  ) {
    addIssue(
      issues,
      "error",
      "metaxpath-params-file",
      'MetaxPath must map config key "paramsFile" to "-params-file" so the DB bundle manifest is passed to Nextflow.',
      "manifest.json"
    );
  }
}

async function validateReferencedFiles(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
) {
  const requiredFiles = [
    ["definition", manifest.files.definition],
    ["registry", manifest.files.registry],
    ["samplesheet", manifest.files.samplesheet],
  ] as const;

  for (const [key, relativePath] of requiredFiles) {
    const fullPath = resolvePackagePath(packageDir, relativePath);
    if (!fullPath || !(await pathExists(fullPath))) {
      addIssue(
        issues,
        "error",
        "missing-required-file",
        `Missing required file: ${key} (${relativePath}).`,
        "manifest.json"
      );
    }
  }

  if (manifest.files.readme) {
    const readmePath = resolvePackagePath(packageDir, manifest.files.readme);
    if (readmePath && !(await pathExists(readmePath))) {
      addIssue(
        issues,
        "warning",
        "missing-readme",
        `README not found: ${manifest.files.readme}.`,
        "manifest.json"
      );
    }
  }

  for (const parserFile of manifest.files.parsers || []) {
    const parserPath = resolvePackagePath(packageDir, parserFile);
    if (!parserPath || !(await pathExists(parserPath))) {
      addIssue(
        issues,
        "error",
        "missing-parser",
        `Parser file not found: ${parserFile}.`,
        "manifest.json"
      );
    }
  }

  for (const [key, relativePath] of Object.entries(manifest.files.scripts || {})) {
    const scriptPath = resolvePackagePath(packageDir, relativePath);
    if (!scriptPath || !(await pathExists(scriptPath))) {
      addIssue(
        issues,
        "error",
        "missing-script",
        `${key} script not found: ${relativePath}.`,
        "manifest.json"
      );
    }
  }
}

async function validateDefinitionAndRegistry(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
) {
  const definitionPath = resolvePackagePath(packageDir, manifest.files.definition);
  if (definitionPath && (await pathExists(definitionPath))) {
    const definition = await readJson(definitionPath);
    if (!definition || typeof definition !== "object") {
      addIssue(issues, "error", "invalid-definition-json", "definition.json is not valid JSON.", manifest.files.definition);
    } else {
      const pipelineId = (definition as { pipeline?: string }).pipeline;
      if (pipelineId && pipelineId !== manifest.package.id) {
        addIssue(
          issues,
          "error",
          "definition-id-mismatch",
          `definition.pipeline "${pipelineId}" does not match package.id "${manifest.package.id}".`,
          manifest.files.definition
        );
      }
    }
  }

  const registryPath = resolvePackagePath(packageDir, manifest.files.registry);
  if (registryPath && (await pathExists(registryPath))) {
    const registry = await readJson(registryPath);
    if (!registry || typeof registry !== "object") {
      addIssue(issues, "error", "invalid-registry-json", "registry.json is not valid JSON.", manifest.files.registry);
    } else {
      const registryId = (registry as { id?: string }).id;
      if (registryId && registryId !== manifest.package.id) {
        addIssue(
          issues,
          "error",
          "registry-id-mismatch",
          `registry.id "${registryId}" does not match package.id "${manifest.package.id}".`,
          manifest.files.registry
        );
      }
    }
  }
}

async function validateSamplesheet(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
) {
  const samplesheetPath = resolvePackagePath(packageDir, manifest.files.samplesheet);
  if (!samplesheetPath || !(await pathExists(samplesheetPath))) return;

  const samplesheet = await readYaml(samplesheetPath);
  const columns = (samplesheet as {
    samplesheet?: { columns?: Array<{ name?: string; source?: string | null }> };
  } | null)?.samplesheet?.columns;

  if (!Array.isArray(columns) || columns.length === 0) {
    addIssue(
      issues,
      "error",
      "samplesheet-columns",
      "samplesheet.yaml must define at least one column.",
      manifest.files.samplesheet
    );
    return;
  }

  const hasSampleColumn = columns.some((column) =>
    column.name === "sample" || column.name === "sample_id"
  );
  if (!hasSampleColumn) {
    addIssue(
      issues,
      "warning",
      "samplesheet-sample-column",
      'samplesheet.yaml should define a "sample" or "sample_id" column for SeqDesk sample matching.',
      manifest.files.samplesheet
    );
  }
}

async function collectParserIds(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
): Promise<Set<string>> {
  const parserIds = new Set<string>();
  for (const parserFile of manifest.files.parsers || []) {
    const parserPath = resolvePackagePath(packageDir, parserFile);
    if (!parserPath || !(await pathExists(parserPath))) continue;

    const parserConfig = await readYaml(parserPath);
    const parserId = (parserConfig as { parser?: { id?: string } } | null)?.parser?.id;
    if (parserId) {
      parserIds.add(parserId);
    } else {
      addIssue(
        issues,
        "warning",
        "parser-id-missing",
        `Parser file missing parser.id: ${parserFile}.`,
        parserFile
      );
    }
  }
  return parserIds;
}

function validateOutputs(
  manifest: Manifest,
  parserIds: Set<string>,
  issues: DescriptorLintIssue[]
) {
  const seenOutputIds = new Set<string>();
  for (const output of manifest.outputs) {
    if (seenOutputIds.has(output.id)) {
      addIssue(
        issues,
        "error",
        "duplicate-output-id",
        `Duplicate output id "${output.id}".`,
        "manifest.json"
      );
    }
    seenOutputIds.add(output.id);

    if (output.parsed?.from && !parserIds.has(output.parsed.from)) {
      addIssue(
        issues,
        "warning",
        "unknown-parser",
        `Output "${output.id}" references parser "${output.parsed.from}" which was not found.`,
        "manifest.json"
      );
    }

    if (output.writeback?.target === "Read" && output.destination !== "sample_reads") {
      addIssue(
        issues,
        "error",
        "read-writeback-destination",
        `Output "${output.id}" uses Read writeback but destination is "${output.destination}" instead of "sample_reads".`,
        "manifest.json"
      );
    }
  }

  if (manifest.outputs.length === 0) {
    addIssue(
      issues,
      "warning",
      "outputs-empty",
      "No curated outputs are configured. Runs can still use raw output folder browsing.",
      "manifest.json"
    );
  }

  if (manifest.package.id === "metaxpath") {
    const hasFinalReportOutput = manifest.outputs.some((output) =>
      output.discovery.pattern.includes("final") &&
      (output.discovery.pattern.endsWith(".html") || output.discovery.pattern.endsWith(".pdf"))
    );
    if (!hasFinalReportOutput) {
      addIssue(
        issues,
        "warning",
        "metaxpath-final-reports",
        "MetaxPath should expose final HTML/PDF reports as curated outputs.",
        "manifest.json"
      );
    }
  }
}

export async function lintPipelineDescriptor(
  packageDir: string,
  expectedPackageId = path.basename(packageDir)
): Promise<DescriptorLintResult> {
  const issues: DescriptorLintIssue[] = [];
  const manifestPath = path.join(packageDir, "manifest.json");

  if (!(await pathExists(manifestPath))) {
    addIssue(issues, "error", "missing-manifest", "Missing manifest.json.", "manifest.json");
    return finalize(expectedPackageId, packageDir, issues);
  }

  const manifestRaw = await readJson(manifestPath);
  if (!manifestRaw) {
    addIssue(issues, "error", "invalid-manifest-json", "manifest.json is not valid JSON.", "manifest.json");
    return finalize(expectedPackageId, packageDir, issues);
  }

  const parsed = ManifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    addIssue(
      issues,
      "error",
      "manifest-schema",
      `manifest.json schema invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "manifest.json"
    );
    return finalize(expectedPackageId, packageDir, issues);
  }

  const manifest = parsed.data;
  if (manifest.package.id !== expectedPackageId) {
    addIssue(
      issues,
      "error",
      "package-id-mismatch",
      `package.id "${manifest.package.id}" does not match expected package id "${expectedPackageId}".`,
      "manifest.json"
    );
  }

  await validateReferencedFiles(packageDir, manifest, issues);
  await validateDefinitionAndRegistry(packageDir, manifest, issues);
  await validateSamplesheet(packageDir, manifest, issues);
  await validateExecution(packageDir, manifest, issues);
  const parserIds = await collectParserIds(packageDir, manifest, issues);
  validateOutputs(manifest, parserIds, issues);

  return finalize(manifest.package.id, packageDir, issues);
}

function finalize(
  packageId: string,
  packageDir: string,
  issues: DescriptorLintIssue[]
): DescriptorLintResult {
  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warning").length;
  return {
    packageId,
    packageDir,
    valid: errors === 0,
    errors,
    warnings,
    issues,
  };
}
