/**
 * MIxS checklist baseline maintenance.
 *
 * With no source directory, this deterministically rebuilds _index.json from
 * the committed checklist JSON files. Legacy ENA XML conversion is available
 * only when its source directory is supplied explicitly; the current repository
 * does not contain the former Django project's project/static/xml directory.
 *
 * Usage:
 *   npx tsx scripts/import-mixs-checklists.ts
 *   npx tsx scripts/import-mixs-checklists.ts --check
 *   npx tsx scripts/import-mixs-checklists.ts --source-dir /path/to/ena/xml
 *
 * Output:
 *   Rebuilds data/field-templates/mixs-full/_index.json and, when
 *   --source-dir is provided, converts that directory's XML files first.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Simple XML parser - we'll parse manually since the structure is predictable
function parseXML(xml: string): ChecklistXML {
  const result: ChecklistXML = {
    accession: "",
    label: "",
    name: "",
    description: "",
    fieldGroups: [],
  };

  // Extract checklist accession
  const accessionMatch = xml.match(/CHECKLIST accession="([^"]+)"/);
  if (accessionMatch) result.accession = accessionMatch[1];

  // Extract descriptor info
  const labelMatch = xml.match(/<DESCRIPTOR>[\s\S]*?<LABEL>([^<]+)<\/LABEL>/);
  if (labelMatch) result.label = labelMatch[1];

  const nameMatch = xml.match(/<DESCRIPTOR>[\s\S]*?<NAME>([^<]+)<\/NAME>/);
  if (nameMatch) result.name = nameMatch[1];

  const descMatch = xml.match(/<DESCRIPTOR>[\s\S]*?<DESCRIPTION>([^<]+)<\/DESCRIPTION>/);
  if (descMatch) result.description = descMatch[1];

  // Parse field groups
  const fieldGroupRegex = /<FIELD_GROUP[^>]*>[\s\S]*?<NAME>([^<]+)<\/NAME>([\s\S]*?)<\/FIELD_GROUP>/g;
  let groupMatch;

  while ((groupMatch = fieldGroupRegex.exec(xml)) !== null) {
    const groupName = groupMatch[1];
    const groupContent = groupMatch[2];
    const fields = parseFields(groupContent);

    result.fieldGroups.push({
      name: groupName,
      fields,
    });
  }

  return result;
}

interface FieldXML {
  label: string;
  name: string;
  description: string;
  mandatory: boolean;
  type: "text" | "select" | "number";
  units?: string[];
  choices?: string[];
  pattern?: string;
}

interface FieldGroupXML {
  name: string;
  fields: FieldXML[];
}

interface ChecklistXML {
  accession: string;
  label: string;
  name: string;
  description: string;
  fieldGroups: FieldGroupXML[];
}

function parseFields(content: string): FieldXML[] {
  const fields: FieldXML[] = [];
  const fieldRegex = /<FIELD>([\s\S]*?)<\/FIELD>/g;
  let match;

  while ((match = fieldRegex.exec(content)) !== null) {
    const fieldContent = match[1];

    // Extract basic info
    const labelMatch = fieldContent.match(/<LABEL>([^<]+)<\/LABEL>/);
    const nameMatch = fieldContent.match(/<NAME>([^<]+)<\/NAME>/);
    const descMatch = fieldContent.match(/<DESCRIPTION>([\s\S]*?)<\/DESCRIPTION>/);
    const mandatoryMatch = fieldContent.match(/<MANDATORY>([^<]+)<\/MANDATORY>/);

    if (!labelMatch || !nameMatch) continue;

    const field: FieldXML = {
      label: labelMatch[1].trim(),
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim().replace(/\s+/g, " ") : "",
      mandatory: mandatoryMatch ? mandatoryMatch[1].trim() === "mandatory" : false,
      type: "text",
    };

    // Extract units
    const unitsMatch = fieldContent.match(/<UNITS>([\s\S]*?)<\/UNITS>/);
    if (unitsMatch) {
      const unitRegex = /<UNIT>([^<]+)<\/UNIT>/g;
      const units: string[] = [];
      let unitMatch;
      while ((unitMatch = unitRegex.exec(unitsMatch[1])) !== null) {
        units.push(unitMatch[1].trim());
      }
      if (units.length > 0) {
        field.units = units;
      }
    }

    // Extract field type
    if (fieldContent.includes("<TEXT_CHOICE_FIELD>")) {
      field.type = "select";
      const choicesRegex = /<VALUE>([^<]+)<\/VALUE>/g;
      const choices: string[] = [];
      let choiceMatch;
      while ((choiceMatch = choicesRegex.exec(fieldContent)) !== null) {
        choices.push(choiceMatch[1].trim());
      }
      if (choices.length > 0) {
        field.choices = choices;
      }
    } else if (fieldContent.includes("<REGEX_VALUE>")) {
      const regexMatch = fieldContent.match(/<REGEX_VALUE>([^<]+)<\/REGEX_VALUE>/);
      if (regexMatch) {
        field.pattern = regexMatch[1];
        // Check if it's a numeric pattern
        if (field.pattern.includes("[0-9]") && !field.pattern.includes("[a-z]") && !field.pattern.includes("[A-Z]")) {
          field.type = "number";
        }
      }
    }

    fields.push(field);
  }

  return fields;
}

// Convert field name to valid identifier
function toFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Convert to v2 field template format
interface V2Field {
  type: string;
  label: string;
  name: string;
  required: boolean;
  visible: boolean;
  helpText?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  units?: { value: string; label: string }[];
  simpleValidation?: {
    pattern?: string;
    patternMessage?: string;
  };
  group?: string;
}

interface V2Template {
  name: string;
  description: string;
  version: string;
  source: string;
  category: string;
  accession: string;
  fields: V2Field[];
}

function convertToV2Template(checklist: ChecklistXML): V2Template {
  const fields: V2Field[] = [];

  for (const group of checklist.fieldGroups) {
    for (const field of group.fields) {
      const v2Field: V2Field = {
        type: field.type === "select" ? "select" : field.type === "number" ? "text" : "text",
        label: field.label,
        name: toFieldName(field.name),
        required: field.mandatory,
        visible: true,
        helpText: field.description,
        group: group.name,
      };

      // Add placeholder from first example if pattern exists
      if (field.pattern) {
        v2Field.simpleValidation = {
          pattern: field.pattern,
          patternMessage: `Must match pattern: ${field.pattern}`,
        };
      }

      // Add choices for select fields
      if (field.choices && field.choices.length > 0) {
        v2Field.options = field.choices.map(c => ({ value: c, label: c }));
      }

      // Add units
      if (field.units && field.units.length > 0) {
        v2Field.units = field.units.map(u => ({ value: u, label: u }));
      }

      fields.push(v2Field);
    }
  }

  return {
    name: checklist.label || checklist.name,
    description: checklist.description,
    version: "1.0.0",
    source: `https://www.ebi.ac.uk/ena/browser/view/${checklist.accession}`,
    category: "mixs",
    accession: checklist.accession,
    fields,
  };
}

interface ChecklistIndexEntry {
  name: string;
  file: string;
  fieldCount: number;
  mandatoryCount: number;
}

interface ChecklistIndex {
  version: number;
  source: string;
  checklists: ChecklistIndexEntry[];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = path.join(scriptDir, "../data/field-templates/mixs-full");

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readCommittedTemplate(outputDir: string, file: string): V2Template {
  const template = JSON.parse(
    fs.readFileSync(path.join(outputDir, file), "utf-8"),
  ) as Partial<V2Template>;

  if (
    typeof template.name !== "string" ||
    typeof template.version !== "string" ||
    typeof template.source !== "string" ||
    typeof template.accession !== "string" ||
    !Array.isArray(template.fields)
  ) {
    throw new Error(`Invalid MIxS checklist JSON: ${file}`);
  }

  return template as V2Template;
}

export function buildChecklistIndex(outputDir = defaultOutputDir): ChecklistIndex {
  const files = fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
    .sort(compareAscii);

  const seenAccessions = new Set<string>();
  const checklists = files.map((file): ChecklistIndexEntry => {
    const template = readCommittedTemplate(outputDir, file);
    if (seenAccessions.has(template.accession)) {
      throw new Error(`Duplicate MIxS checklist accession ${template.accession}`);
    }
    seenAccessions.add(template.accession);

    return {
      name: template.name,
      file,
      fieldCount: template.fields.length,
      mandatoryCount: template.fields.filter((field) => field.required).length,
    };
  });

  return {
    version: 1,
    source: "ENA MIxS Checklists (each JSON definition records its ENA accession URL)",
    checklists,
  };
}

export function renderChecklistIndex(outputDir = defaultOutputDir): string {
  return `${JSON.stringify(buildChecklistIndex(outputDir), null, 2)}\n`;
}

export function writeChecklistIndex(outputDir = defaultOutputDir): string {
  const indexPath = path.join(outputDir, "_index.json");
  fs.writeFileSync(indexPath, renderChecklistIndex(outputDir), "utf-8");
  return indexPath;
}

export function checkChecklistIndex(outputDir = defaultOutputDir): boolean {
  const indexPath = path.join(outputDir, "_index.json");
  return (
    fs.existsSync(indexPath) &&
    fs.readFileSync(indexPath, "utf-8") === renderChecklistIndex(outputDir)
  );
}

export function importLegacyXmlChecklists(
  sourceDir: string,
  outputDir = defaultOutputDir,
): number {
  if (!fs.statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`MIxS XML source directory does not exist: ${sourceDir}`);
  }

  const xmlFiles = fs
    .readdirSync(sourceDir)
    .filter((file) => file.endsWith(".xml"))
    .filter((file) => !file.includes("template") && !file.includes("submission"))
    .sort(compareAscii);

  const imports = xmlFiles.map((xmlFile) => {
    const xmlContent = fs.readFileSync(path.join(sourceDir, xmlFile), "utf-8");
    const template = convertToV2Template(parseXML(xmlContent));
    if (!template.accession.trim()) {
      throw new Error(`MIxS XML checklist has no accession: ${xmlFile}`);
    }
    const baseName = xmlFile
      .replace(/\.xml$/i, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      xmlFile,
      template,
      proposedFile: `mixs-${baseName}.json`,
    };
  });

  const outputExists = fs.existsSync(outputDir);
  const existingFiles = outputExists
    ? fs
        .readdirSync(outputDir)
        .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
        .sort(compareAscii)
    : [];
  const existingByAccession = new Map<string, string>();
  const accessionByFile = new Map<string, string>();
  for (const file of existingFiles) {
    const template = readCommittedTemplate(outputDir, file);
    if (existingByAccession.has(template.accession)) {
      throw new Error(`Duplicate MIxS checklist accession ${template.accession}`);
    }
    existingByAccession.set(template.accession, file);
    accessionByFile.set(file, template.accession);
  }

  const importedAccessions = new Set<string>();
  const resolvedImports = imports.map((entry) => {
    if (importedAccessions.has(entry.template.accession)) {
      throw new Error(
        `Duplicate imported MIxS checklist accession ${entry.template.accession}`,
      );
    }
    importedAccessions.add(entry.template.accession);

    // Preserve the repository's established filename when refreshing a known
    // accession. Legacy XML basenames do not consistently match those names
    // (for example ENADefaultSampleChecklist.xml -> mixs-default.json).
    const outputFile =
      existingByAccession.get(entry.template.accession) ?? entry.proposedFile;
    const occupyingAccession = accessionByFile.get(outputFile);
    if (
      occupyingAccession !== undefined &&
      occupyingAccession !== entry.template.accession
    ) {
      throw new Error(
        `MIxS import filename collision: ${outputFile} belongs to ${occupyingAccession}`,
      );
    }
    accessionByFile.set(outputFile, entry.template.accession);
    return { ...entry, outputFile };
  });

  const outputParent = path.dirname(outputDir);
  fs.mkdirSync(outputParent, { recursive: true });
  const stagingDir = fs.mkdtempSync(
    path.join(outputParent, `.${path.basename(outputDir)}-import-`),
  );
  const backupDir = `${stagingDir}-previous`;
  let outputMovedToBackup = false;

  try {
    if (outputExists) {
      fs.chmodSync(stagingDir, fs.statSync(outputDir).mode & 0o777);
      for (const entry of fs.readdirSync(outputDir)) {
        fs.cpSync(path.join(outputDir, entry), path.join(stagingDir, entry), {
          recursive: true,
          preserveTimestamps: true,
        });
      }
    }

    for (const entry of resolvedImports) {
      fs.writeFileSync(
        path.join(stagingDir, entry.outputFile),
        `${JSON.stringify(entry.template, null, 2)}\n`,
        "utf-8",
      );
    }

    // Build the index against the complete staged directory. Duplicate
    // accessions, invalid JSON, and index-generation errors are therefore
    // detected before any committed baseline file is replaced.
    writeChecklistIndex(stagingDir);

    if (outputExists) {
      fs.renameSync(outputDir, backupDir);
      outputMovedToBackup = true;
    }
    try {
      fs.renameSync(stagingDir, outputDir);
    } catch (error) {
      if (outputMovedToBackup) {
        fs.renameSync(backupDir, outputDir);
        outputMovedToBackup = false;
      }
      throw error;
    }

    if (outputMovedToBackup) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      outputMovedToBackup = false;
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (outputMovedToBackup && !fs.existsSync(outputDir)) {
      fs.renameSync(backupDir, outputDir);
      outputMovedToBackup = false;
    }
  }

  for (const entry of resolvedImports) {
    console.log(`Converted ${entry.xmlFile} -> ${entry.outputFile}`);
  }

  return xmlFiles.length;
}

interface CliOptions {
  check: boolean;
  outputDir: string;
  sourceDir?: string;
}

function usage(): string {
  return [
    "Usage: npx tsx scripts/import-mixs-checklists.ts [options]",
    "",
    "Options:",
    "  --check              Fail if _index.json differs from committed JSON files",
    "  --output-dir PATH    Checklist JSON directory (defaults to the repository baseline)",
    "  --source-dir PATH    Explicit legacy ENA XML directory to import before indexing",
    "  -h, --help           Show this help",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { check: false, outputDir: defaultOutputDir };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--output-dir" || arg === "--source-dir") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === "--output-dir") options.outputDir = path.resolve(value);
      else options.sourceDir = path.resolve(value);
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exitCode = 0;
      return options;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function main(args = process.argv.slice(2)): void {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    return;
  }

  const options = parseArgs(args);
  if (options.check && options.sourceDir) {
    throw new Error("--check cannot be combined with --source-dir because import writes JSON files");
  }
  if (options.sourceDir) {
    const imported = importLegacyXmlChecklists(options.sourceDir, options.outputDir);
    console.log(`Imported ${imported} legacy ENA XML checklist file(s)`);
    console.log(`Created index at: ${path.join(options.outputDir, "_index.json")}`);
    return;
  }

  if (options.check) {
    if (!checkChecklistIndex(options.outputDir)) {
      throw new Error(
        `MIxS checklist index is stale; run npx tsx scripts/import-mixs-checklists.ts --output-dir ${options.outputDir}`,
      );
    }
    console.log(`MIxS checklist index is current: ${path.join(options.outputDir, "_index.json")}`);
    return;
  }

  console.log(`Created index at: ${writeChecklistIndex(options.outputDir)}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
