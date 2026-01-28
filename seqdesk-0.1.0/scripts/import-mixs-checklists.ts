/**
 * MIxS Checklist Import Script
 *
 * This script reads the ENA MIxS XML checklist files from v1 and converts them
 * to the v2 JSON field template format.
 *
 * Usage:
 *   npx tsx scripts/import-mixs-checklists.ts
 *
 * Output:
 *   Creates JSON files in data/field-templates/mixs-full/ directory
 */

import * as fs from "fs";
import * as path from "path";

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

// Main execution
async function main() {
  const v1XmlDir = path.join(__dirname, "../../project/static/xml");
  const v2OutputDir = path.join(__dirname, "../data/field-templates/mixs-full");

  // Create output directory
  if (!fs.existsSync(v2OutputDir)) {
    fs.mkdirSync(v2OutputDir, { recursive: true });
  }

  // List of XML files to process (excluding non-checklist files)
  const xmlFiles = fs.readdirSync(v1XmlDir)
    .filter(f => f.endsWith(".xml"))
    .filter(f => !f.includes("template") && !f.includes("submission"));

  console.log(`Found ${xmlFiles.length} XML files to process`);
  console.log("---");

  const summary: { name: string; fields: number; mandatory: number }[] = [];

  for (const xmlFile of xmlFiles) {
    const xmlPath = path.join(v1XmlDir, xmlFile);
    const xmlContent = fs.readFileSync(xmlPath, "utf-8");

    try {
      const checklist = parseXML(xmlContent);
      const v2Template = convertToV2Template(checklist);

      // Generate output filename
      const baseName = xmlFile.replace(".xml", "").toLowerCase().replace(/([A-Z])/g, "-$1").replace(/^-/, "");
      const outputFile = `mixs-${baseName}.json`;
      const outputPath = path.join(v2OutputDir, outputFile);

      fs.writeFileSync(outputPath, JSON.stringify(v2Template, null, 2));

      const mandatoryCount = v2Template.fields.filter(f => f.required).length;
      summary.push({
        name: v2Template.name,
        fields: v2Template.fields.length,
        mandatory: mandatoryCount,
      });

      console.log(`Converted: ${xmlFile} -> ${outputFile}`);
      console.log(`  Name: ${v2Template.name}`);
      console.log(`  Accession: ${v2Template.accession}`);
      console.log(`  Fields: ${v2Template.fields.length} (${mandatoryCount} mandatory)`);
      console.log("");
    } catch (error) {
      console.error(`Error processing ${xmlFile}:`, error);
    }
  }

  // Write summary
  console.log("---");
  console.log("Summary:");
  console.log("---");
  for (const item of summary) {
    console.log(`${item.name}: ${item.fields} fields (${item.mandatory} mandatory)`);
  }

  // Create an index file
  const indexPath = path.join(v2OutputDir, "_index.json");
  const index = {
    generated: new Date().toISOString(),
    source: "ENA MIxS Checklists",
    checklists: summary.map(s => ({
      name: s.name,
      file: `mixs-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
      fieldCount: s.fields,
      mandatoryCount: s.mandatory,
    })),
  };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log("");
  console.log(`Created index at: ${indexPath}`);
  console.log(`Output directory: ${v2OutputDir}`);
}

main().catch(console.error);
