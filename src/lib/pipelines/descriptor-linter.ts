import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { ManifestSchema, type Manifest } from "./manifest-schema";
import {
  DefinitionRuntimeSchema,
  ParserRuntimeSchema,
  RegistryRuntimeSchema,
  SamplesheetRuntimeSchema,
} from "./package-descriptor-schema";
import { inferPipelineResultContract } from "./package-contracts";
import { isSafePipelineFlagToken } from "./package-patterns";
import {
  hasSupportedCustomPipelineRunner,
  isLocalPipelineReference,
} from "./pipeline-paths";

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

function resolvePackagePath(
  packageDir: string,
  relativePath?: string,
  options: { allowBase?: boolean } = {}
): string | null {
  if (!relativePath) return null;
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) return null;
  const baseResolved = path.resolve(packageDir);
  const resolved = path.resolve(baseResolved, relativePath);
  const relative = path.relative(baseResolved, resolved);
  if (
    (!options.allowBase && relative.length === 0) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return resolved;
}

function looksLikeFlag(value: string): boolean {
  return value === "" || isSafePipelineFlagToken(value);
}

interface DefinitionDescriptor {
  pipeline?: string;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  steps?: Array<{
    id?: unknown;
    name?: unknown;
    description?: unknown;
    category?: unknown;
    dependsOn?: unknown;
    processMatchers?: unknown;
  }>;
  outputs?: Array<{
    id?: unknown;
    fromStep?: unknown;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateManifestFilePaths(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
): void {
  const paths = [
    manifest.files.definition,
    manifest.files.registry,
    manifest.files.samplesheet,
    manifest.files.readme,
    ...(manifest.files.parsers || []),
    ...Object.values(manifest.files.scripts || {}),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const relativePath of paths) {
    if (!resolvePackagePath(packageDir, relativePath)) {
      addIssue(
        issues,
        "error",
        "package-path-traversal",
        `Package file path must stay inside the package directory: ${relativePath}.`,
        "manifest.json"
      );
    }
  }
}

function validateDefinitionContract(
  definition: DefinitionDescriptor,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
) {
  if (definition.pipeline !== manifest.package.id) {
    addIssue(
      issues,
      "error",
      "definition-id-mismatch",
      `definition.pipeline "${String(definition.pipeline ?? "missing")}" does not match package.id "${manifest.package.id}".`,
      manifest.files.definition
    );
  }
  for (const [field, value] of [
    ["name", definition.name],
    ["description", definition.description],
    ["version", definition.version],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      addIssue(
        issues,
        "error",
        "definition-shape",
        `definition.${field} must be a non-empty string.`,
        manifest.files.definition
      );
    }
  }
  if (!Array.isArray(definition.steps)) {
    addIssue(
      issues,
      "error",
      "definition-shape",
      "definition.steps must be an array.",
      manifest.files.definition
    );
  }

  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const stepIds = new Set<string>();

  for (const step of steps) {
    if (typeof step.id !== "string" || !step.id.trim()) {
      addIssue(
        issues,
        "error",
        "definition-step-id",
        "Every definition step must have a non-empty id.",
        manifest.files.definition
      );
      continue;
    }
    for (const [field, value] of [
      ["name", step.name],
      ["description", step.description],
      ["category", step.category],
    ] as const) {
      if (typeof value !== "string" || value.trim().length === 0) {
        addIssue(
          issues,
          "error",
          "definition-step-shape",
          `Step "${step.id}" must have a non-empty ${field}.`,
          manifest.files.definition
        );
      }
    }
    if (
      !Array.isArray(step.dependsOn) ||
      step.dependsOn.some((dependency) => typeof dependency !== "string")
    ) {
      addIssue(
        issues,
        "error",
        "definition-step-shape",
        `Step "${step.id}" dependsOn must be an array of step IDs.`,
        manifest.files.definition
      );
    }

    if (stepIds.has(step.id)) {
      addIssue(
        issues,
        "error",
        "duplicate-step-id",
        `Duplicate definition step id: ${step.id}.`,
        manifest.files.definition
      );
    }
    stepIds.add(step.id);
  }

  for (const step of steps) {
    if (typeof step.id !== "string" || !step.id.trim()) continue;

    if (Array.isArray(step.dependsOn)) {
      for (const dependency of step.dependsOn) {
        if (typeof dependency === "string" && !stepIds.has(dependency)) {
          addIssue(
            issues,
            "error",
            "step-dependency-missing",
            `Step "${step.id}" depends on missing step "${dependency}".`,
            manifest.files.definition
          );
        }
      }
    }

    if (
      manifest.execution.type === "nextflow" &&
      (!Array.isArray(step.processMatchers) || step.processMatchers.length === 0)
    ) {
      addIssue(
        issues,
        "warning",
        "step-process-matchers",
        `Step "${step.id}" has no processMatchers, so trace progress cannot map Nextflow processes to this DAG step.`,
        manifest.files.definition
      );
    }
  }

  for (const output of definition.outputs || []) {
    if (
      typeof output.fromStep === "string" &&
      output.fromStep &&
      !stepIds.has(output.fromStep)
    ) {
      addIssue(
        issues,
        "error",
        "definition-output-from-step-missing",
        `Definition output "${String(output.id || "unknown")}" references missing step "${output.fromStep}".`,
        manifest.files.definition
      );
    }
  }

  for (const output of manifest.outputs) {
    if (output.fromStep && !stepIds.has(output.fromStep)) {
      addIssue(
        issues,
        "error",
        "output-from-step-missing",
        `Manifest output "${output.id}" references missing definition step "${output.fromStep}".`,
        "manifest.json"
      );
    }
  }
}

function validateRegistryContract(
  registry: Record<string, unknown>,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
): void {
  const file = manifest.files.registry;
  if (registry.id !== manifest.package.id) {
    addIssue(
      issues,
      "error",
      "registry-id-mismatch",
      `registry.id "${String(registry.id ?? "missing")}" does not match package.id "${manifest.package.id}".`,
      file
    );
  }

  for (const field of ["name", "description", "category", "version", "icon"] as const) {
    const value = registry[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      addIssue(
        issues,
        "error",
        "registry-shape",
        `registry.${field} must be a non-empty string.`,
        file
      );
    }
  }

  if (!isRecord(registry.requires)) {
    addIssue(issues, "error", "registry-shape", "registry.requires must be an object.", file);
  }
  if (!Array.isArray(registry.outputs)) {
    addIssue(issues, "error", "registry-shape", "registry.outputs must be an array.", file);
  }

  const visibility = registry.visibility;
  if (
    !isRecord(visibility) ||
    typeof visibility.showToUser !== "boolean" ||
    typeof visibility.userCanStart !== "boolean"
  ) {
    addIssue(
      issues,
      "error",
      "registry-shape",
      "registry.visibility must define boolean showToUser and userCanStart values.",
      file
    );
  }

  const input = registry.input;
  const perSample = isRecord(input) ? input.perSample : null;
  if (
    !isRecord(input) ||
    !Array.isArray(input.supportedScopes) ||
    !isRecord(perSample) ||
    typeof perSample.reads !== "boolean" ||
    typeof perSample.pairedEnd !== "boolean"
  ) {
    addIssue(
      issues,
      "error",
      "registry-shape",
      "registry.input must define supportedScopes and boolean perSample.reads/pairedEnd values.",
      file
    );
  }

  const samplesheet = registry.samplesheet;
  if (
    !isRecord(samplesheet) ||
    typeof samplesheet.format !== "string" ||
    typeof samplesheet.generator !== "string"
  ) {
    addIssue(
      issues,
      "error",
      "registry-shape",
      "registry.samplesheet must define format and generator.",
      file
    );
  }

  const configSchema = registry.configSchema;
  if (
    !isRecord(configSchema) ||
    configSchema.type !== "object" ||
    !isRecord(configSchema.properties)
  ) {
    addIssue(
      issues,
      "error",
      "registry-shape",
      'registry.configSchema must be an object schema with a "properties" object.',
      file
    );
  }
  if (!isRecord(registry.defaultConfig)) {
    addIssue(
      issues,
      "error",
      "registry-shape",
      "registry.defaultConfig must be an object.",
      file
    );
  }
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

  if (isLocalPipelineReference(manifest.execution.pipeline)) {
    const pipelinePath = resolvePackagePath(
      packageDir,
      manifest.execution.pipeline,
      { allowBase: true }
    );
    if (!pipelinePath) {
      addIssue(
        issues,
        "error",
        "execution-pipeline-path",
        `Local execution.pipeline path must stay inside the package directory: ${manifest.execution.pipeline}.`,
        "manifest.json"
      );
    } else if (
      !(await pathExists(pipelinePath)) &&
      !hasSupportedCustomPipelineRunner(manifest)
    ) {
      addIssue(
        issues,
        "error",
        "local-workflow-missing",
        `Local execution.pipeline path does not exist: ${manifest.execution.pipeline}.`,
        "manifest.json"
      );
    }
  }

  for (const [key, flag] of Object.entries(manifest.execution.paramMap || {})) {
    if (!looksLikeFlag(flag)) {
      addIssue(
        issues,
        "error",
        "param-map-flag",
        `paramMap.${key} must be a single safe Nextflow flag or an empty SeqDesk-only mapping.`,
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
        "error",
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
    const definitionResult = DefinitionRuntimeSchema.safeParse(definition);
    if (!definitionResult.success) {
      addIssue(
        issues,
        "error",
        "definition-shape",
        `definition.json is invalid: ${definitionResult.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")}`,
        manifest.files.definition
      );
    } else {
      validateDefinitionContract(
        definitionResult.data as DefinitionDescriptor,
        manifest,
        issues
      );
    }
  }

  const registryPath = resolvePackagePath(packageDir, manifest.files.registry);
  if (registryPath && (await pathExists(registryPath))) {
    const registry = await readJson(registryPath);
    const registryResult = RegistryRuntimeSchema.safeParse(registry);
    if (!registryResult.success) {
      addIssue(
        issues,
        "error",
        "registry-shape",
        `registry.json is invalid: ${registryResult.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")}`,
        manifest.files.registry
      );
    } else {
      validateRegistryContract(registryResult.data, manifest, issues);
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
  const samplesheetResult = SamplesheetRuntimeSchema.safeParse(samplesheet);
  if (!samplesheetResult.success) {
    addIssue(
      issues,
      "error",
      "samplesheet-shape",
      `samplesheet.yaml is invalid: ${samplesheetResult.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
      manifest.files.samplesheet
    );
    return;
  }

  const columns = samplesheetResult.data.samplesheet.columns;
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

async function collectParserColumns(
  packageDir: string,
  manifest: Manifest,
  issues: DescriptorLintIssue[]
): Promise<Map<string, Set<string>>> {
  const parserColumns = new Map<string, Set<string>>();
  for (const parserFile of manifest.files.parsers || []) {
    const parserPath = resolvePackagePath(packageDir, parserFile);
    if (!parserPath || !(await pathExists(parserPath))) continue;

    const parserConfig = await readYaml(parserPath);
    const parserResult = ParserRuntimeSchema.safeParse(parserConfig);
    if (!parserResult.success) {
      addIssue(
        issues,
        "error",
        "parser-shape",
        `Parser file is invalid: ${parserResult.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")}`,
        parserFile
      );
      continue;
    }
    const parserId = parserResult.data.parser.id;
    if (parserColumns.has(parserId)) {
      addIssue(
        issues,
        "error",
        "duplicate-parser-id",
        `Duplicate parser id "${parserId}".`,
        parserFile
      );
      continue;
    }
    const columnNames = new Set<string>();
    for (const column of parserResult.data.parser.columns) {
      if (columnNames.has(column.name)) {
        addIssue(
          issues,
          "error",
          "duplicate-parser-column",
          `Parser "${parserId}" has duplicate column name "${column.name}".`,
          parserFile
        );
      }
      columnNames.add(column.name);
    }
    parserColumns.set(parserId, columnNames);
  }
  return parserColumns;
}

function validateOutputs(
  manifest: Manifest,
  parserColumns: Map<string, Set<string>>,
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

    if (
      output.scope === "sample" &&
      output.required !== false &&
      !output.discovery.matchSampleBy &&
      !manifest.files.scripts?.discoverOutputs
    ) {
      addIssue(
        issues,
        "error",
        "sample-output-match-strategy",
        `Required sample output "${output.id}" must define discovery.matchSampleBy unless a custom discoverOutputs script supplies sample IDs.`,
        "manifest.json"
      );
    }

    if (output.parsed) {
      const columns = parserColumns.get(output.parsed.from);
      if (!columns) {
        addIssue(
          issues,
          "error",
          "unknown-parser",
          `Output "${output.id}" references parser "${output.parsed.from}" which was not found.`,
          "manifest.json"
        );
      } else {
        if (!columns.has(output.parsed.matchBy)) {
          addIssue(
            issues,
            "error",
            "unknown-parser-match-column",
            `Output "${output.id}" matchBy references unknown parser column "${output.parsed.matchBy}".`,
            "manifest.json"
          );
        }
        for (const sourceColumn of Object.values(output.parsed.map)) {
          if (!columns.has(sourceColumn)) {
            addIssue(
              issues,
              "error",
              "unknown-parser-map-column",
              `Output "${output.id}" maps unknown parser column "${sourceColumn}".`,
              "manifest.json"
            );
          }
        }
      }
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
    if (output.writeback?.target === "Read" && output.scope !== "sample") {
      addIssue(
        issues,
        "error",
        "read-writeback-scope",
        `Output "${output.id}" uses Read writeback but scope is "${output.scope}" instead of "sample".`,
        "manifest.json"
      );
    }

    const result = inferPipelineResultContract(output);
    if (result.kind === "sample_read_candidate") {
      if (output.scope !== "sample") {
        addIssue(
          issues,
          "error",
          "read-candidate-scope",
          `Output "${output.id}" stages read candidates but scope is "${output.scope}" instead of "sample".`,
          "manifest.json"
        );
      }

      if (output.destination !== "run_artifact") {
        addIssue(
          issues,
          "error",
          "read-candidate-destination",
          `Output "${output.id}" stages read candidates but destination is "${output.destination}" instead of "run_artifact".`,
          "manifest.json"
        );
      }

      if (result.writebackPolicy !== "admin_review") {
        addIssue(
          issues,
          "warning",
          "read-candidate-review-policy",
          `Output "${output.id}" stages read candidates without an explicit admin_review writeback policy.`,
          "manifest.json"
        );
      }
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

  validateManifestFilePaths(packageDir, manifest, issues);
  await validateReferencedFiles(packageDir, manifest, issues);
  await validateDefinitionAndRegistry(packageDir, manifest, issues);
  await validateSamplesheet(packageDir, manifest, issues);
  await validateExecution(packageDir, manifest, issues);
  const parserColumns = await collectParserColumns(packageDir, manifest, issues);
  validateOutputs(manifest, parserColumns, issues);

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
