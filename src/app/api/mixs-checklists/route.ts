import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export interface MixsField {
  type: string;
  label: string;
  name: string;
  required: boolean;
  visible: boolean;
  helpText?: string;
  group?: string;
  options?: { value: string; label: string }[];
  units?: { value: string; label: string }[];
  simpleValidation?: {
    pattern?: string;
    patternMessage?: string;
  };
}

export interface MixsChecklist {
  name: string;
  description: string;
  version: string;
  source: string;
  category: string;
  accession: string;
  fields: MixsField[];
}

// Cache for loaded checklists
let checklistCache: Map<string, MixsChecklist> | null = null;
let indexCache: { name: string; file: string; fieldCount: number; mandatoryCount: number; accession?: string }[] | null = null;

function loadChecklists(): Map<string, MixsChecklist> {
  if (checklistCache) return checklistCache;

  const templatesDir = path.join(process.cwd(), "data/field-templates/mixs-full");
  const cache = new Map<string, MixsChecklist>();

  if (!fs.existsSync(templatesDir)) {
    console.warn("MIxS templates directory not found:", templatesDir);
    return cache;
  }

  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith(".json") && !f.startsWith("_"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(templatesDir, file), "utf-8");
      const checklist = JSON.parse(content) as MixsChecklist;
      cache.set(checklist.accession || file.replace(".json", ""), checklist);
    } catch (error) {
      console.error(`Error loading checklist ${file}:`, error);
    }
  }

  checklistCache = cache;
  return cache;
}

function loadIndex(): typeof indexCache {
  if (indexCache) return indexCache;

  const templatesDir = path.join(process.cwd(), "data/field-templates/mixs-full");
  const indexPath = path.join(templatesDir, "_index.json");

  if (!fs.existsSync(indexPath)) {
    // Generate index from files
    const checklists = loadChecklists();
    indexCache = Array.from(checklists.values()).map(c => ({
      name: c.name,
      file: `mixs-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
      fieldCount: c.fields.length,
      mandatoryCount: c.fields.filter(f => f.required).length,
      accession: c.accession,
    }));
    return indexCache;
  }

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    const data = JSON.parse(content);
    indexCache = data.checklists;
    return indexCache;
  } catch (error) {
    console.error("Error loading index:", error);
    return [];
  }
}

// GET /api/mixs-checklists - List all available checklists
// GET /api/mixs-checklists?accession=ERC000022 - Get specific checklist by accession
// GET /api/mixs-checklists?name=soil - Get checklist by name (partial match)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accession = searchParams.get("accession");
  const name = searchParams.get("name");

  // Return specific checklist
  if (accession) {
    const checklists = loadChecklists();
    const checklist = checklists.get(accession);

    if (!checklist) {
      return NextResponse.json(
        { error: `Checklist not found: ${accession}` },
        { status: 404 }
      );
    }

    return NextResponse.json(checklist);
  }

  // Search by name
  if (name) {
    const checklists = loadChecklists();
    const searchTerm = name.toLowerCase();

    for (const [, checklist] of checklists) {
      if (checklist.name.toLowerCase().includes(searchTerm)) {
        return NextResponse.json(checklist);
      }
    }

    return NextResponse.json(
      { error: `Checklist not found matching: ${name}` },
      { status: 404 }
    );
  }

  // Return index of all checklists
  const index = loadIndex();

  // Also load accessions from actual files
  const checklists = loadChecklists();
  const enrichedIndex = index?.map(item => {
    const checklist = Array.from(checklists.values()).find(c => c.name === item.name);
    return {
      ...item,
      accession: checklist?.accession || item.accession,
      description: checklist?.description,
    };
  }) || [];

  return NextResponse.json({
    checklists: enrichedIndex,
    total: enrichedIndex.length,
  });
}
