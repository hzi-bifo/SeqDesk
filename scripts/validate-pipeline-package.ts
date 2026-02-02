import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ManifestSchema } from "../src/lib/pipelines/manifest-schema";

type IssueLevel = "error" | "warning";

interface Issue {
  level: IssueLevel;
  packageId: string;
  file?: string;
  message: string;
}

function addIssue(
  issues: Issue[],
  level: IssueLevel,
  packageId: string,
  message: string,
  file?: string
) {
  issues.push({ level, packageId, message, file });
}

function readJsonFile(filePath: string): unknown | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readYamlFile(filePath: string): unknown | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return yaml.load(content) as unknown;
  } catch {
    return null;
  }
}

function fileExists(baseDir: string, relativePath?: string): string | null {
  if (!relativePath) return null;
  const fullPath = path.join(baseDir, relativePath);
  return fs.existsSync(fullPath) ? fullPath : null;
}

function validatePackage(packageDir: string, packageName: string): Issue[] {
  const issues: Issue[] = [];
  const manifestPath = path.join(packageDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    addIssue(issues, "error", packageName, "Missing manifest.json");
    return issues;
  }

  const manifestRaw = readJsonFile(manifestPath);
  if (!manifestRaw) {
    addIssue(issues, "error", packageName, "manifest.json is not valid JSON", manifestPath);
    return issues;
  }

  const parsed = ManifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    addIssue(
      issues,
      "error",
      packageName,
      `manifest.json schema invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      manifestPath
    );
    return issues;
  }

  const manifest = parsed.data;

  if (manifest.package.id !== packageName) {
    addIssue(
      issues,
      "error",
      packageName,
      `package.id "${manifest.package.id}" does not match folder name "${packageName}"`,
      manifestPath
    );
  }

  const requiredFiles = [
    { key: "definition", path: manifest.files.definition },
    { key: "registry", path: manifest.files.registry },
    { key: "samplesheet", path: manifest.files.samplesheet },
  ];

  for (const required of requiredFiles) {
    if (!fileExists(packageDir, required.path)) {
      addIssue(
        issues,
        "error",
        packageName,
        `Missing required file: ${required.key} (${required.path})`,
        manifestPath
      );
    }
  }

  if (manifest.files.readme && !fileExists(packageDir, manifest.files.readme)) {
    addIssue(
      issues,
      "warning",
      packageName,
      `README not found: ${manifest.files.readme}`,
      manifestPath
    );
  }

  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      if (!fileExists(packageDir, parserFile)) {
        addIssue(
          issues,
          "error",
          packageName,
          `Parser file not found: ${parserFile}`,
          manifestPath
        );
      }
    }
  }

  if (manifest.files.scripts?.samplesheet) {
    if (!fileExists(packageDir, manifest.files.scripts.samplesheet)) {
      addIssue(
        issues,
        "error",
        packageName,
        `Samplesheet script not found: ${manifest.files.scripts.samplesheet}`,
        manifestPath
      );
    }
  }

  if (manifest.files.scripts?.discoverOutputs) {
    if (!fileExists(packageDir, manifest.files.scripts.discoverOutputs)) {
      addIssue(
        issues,
        "error",
        packageName,
        `Output discovery script not found: ${manifest.files.scripts.discoverOutputs}`,
        manifestPath
      );
    }
  }

  const definitionPath = fileExists(packageDir, manifest.files.definition);
  if (definitionPath) {
    const definition = readJsonFile(definitionPath);
    if (!definition || typeof definition !== "object") {
      addIssue(
        issues,
        "error",
        packageName,
        "definition.json is not valid JSON",
        definitionPath
      );
    } else {
      const pipelineId = (definition as { pipeline?: string }).pipeline;
      if (pipelineId && pipelineId !== manifest.package.id) {
        addIssue(
          issues,
          "error",
          packageName,
          `definition.pipeline "${pipelineId}" does not match package.id "${manifest.package.id}"`,
          definitionPath
        );
      }
    }
  }

  const registryPath = fileExists(packageDir, manifest.files.registry);
  if (registryPath) {
    const registry = readJsonFile(registryPath);
    if (!registry || typeof registry !== "object") {
      addIssue(
        issues,
        "error",
        packageName,
        "registry.json is not valid JSON",
        registryPath
      );
    } else {
      const registryId = (registry as { id?: string }).id;
      if (registryId && registryId !== manifest.package.id) {
        addIssue(
          issues,
          "error",
          packageName,
          `registry.id "${registryId}" does not match package.id "${manifest.package.id}"`,
          registryPath
        );
      }
    }
  }

  const parserIds = new Set<string>();
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = fileExists(packageDir, parserFile);
      if (!parserPath) continue;
      const parserConfig = readYamlFile(parserPath);
      const parserId = (parserConfig as { parser?: { id?: string } })?.parser?.id;
      if (parserId) {
        parserIds.add(parserId);
      } else {
        addIssue(
          issues,
          "warning",
          packageName,
          `Parser file missing parser.id: ${parserFile}`,
          parserPath
        );
      }
    }
  }

  for (const output of manifest.outputs) {
    if (output.parsed?.from && !parserIds.has(output.parsed.from)) {
      addIssue(
        issues,
        "warning",
        packageName,
        `Output "${output.id}" references parser "${output.parsed.from}" which was not found`,
        manifestPath
      );
    }
  }

  return issues;
}

function run(): number {
  const pipelinesDir = path.join(process.cwd(), "pipelines");

  if (!fs.existsSync(pipelinesDir)) {
    console.error("Pipelines directory not found:", pipelinesDir);
    return 1;
  }

  const entries = fs.readdirSync(pipelinesDir, { withFileTypes: true });
  const packageDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"));

  const issues: Issue[] = [];

  for (const dirName of packageDirs) {
    const packageDir = path.join(pipelinesDir, dirName);
    issues.push(...validatePackage(packageDir, dirName));
  }

  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  for (const issue of issues) {
    const prefix = issue.level === "error" ? "ERROR" : "WARN";
    const location = issue.file ? ` (${issue.file})` : "";
    console.log(`[${prefix}] ${issue.packageId}: ${issue.message}${location}`);
  }

  console.log(
    `Checked ${packageDirs.length} package(s): ${errors.length} error(s), ${warnings.length} warning(s)`
  );

  return errors.length > 0 ? 1 : 0;
}

process.exit(run());
