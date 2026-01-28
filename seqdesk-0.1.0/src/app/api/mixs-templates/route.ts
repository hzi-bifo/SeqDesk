import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

interface FieldTemplate {
  name: string;
  description: string;
  version: string;
  source?: string;
  category?: string;
  fields: Array<{
    type: string;
    label: string;
    name: string;
    required: boolean;
    visible: boolean;
    helpText?: string;
    placeholder?: string;
    example?: string;
    options?: Array<{ value: string; label: string }>;
    aiValidation?: {
      enabled: boolean;
      prompt: string;
      strictness?: string;
    };
  }>;
}

// Recursively collect JSON files from a directory
function collectJsonFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, files);
    } else if (entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Normalize template name for matching (lowercase, remove spaces/hyphens)
function normalizeTemplateName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, "");
}

// GET MIxS templates - optionally filter by name
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const checklistName = searchParams.get("name");

    // Load all templates from the field-templates directory (including subdirectories)
    const templatesDir = path.join(process.cwd(), "data", "field-templates");

    if (!fs.existsSync(templatesDir)) {
      return NextResponse.json({ templates: [] });
    }

    const jsonFiles = collectJsonFiles(templatesDir);
    const allTemplates: FieldTemplate[] = [];

    for (const filePath of jsonFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const template = JSON.parse(content) as FieldTemplate;

        // Only include MIxS templates (category === "mixs")
        if (template.category === "mixs") {
          allTemplates.push(template);
        }
      } catch (err) {
        console.error(`Error parsing ${filePath}:`, err);
      }
    }

    // If a specific name is requested, return just that template
    if (checklistName) {
      const normalizedSearch = normalizeTemplateName(checklistName);

      // Find all matching templates (exact or fuzzy)
      const matchingTemplates = allTemplates.filter((t) => {
        const normalizedName = normalizeTemplateName(t.name);
        return (
          t.name === checklistName ||
          normalizedName === normalizedSearch ||
          normalizedName.includes(normalizedSearch) ||
          normalizedSearch.includes(normalizedName.replace("gscmixs", "mixs"))
        );
      });

      if (matchingTemplates.length === 0) {
        return NextResponse.json(
          { error: "Template not found" },
          { status: 404 }
        );
      }

      // Sort by number of fields (descending) and return the most complete template
      matchingTemplates.sort((a, b) => b.fields.length - a.fields.length);
      return NextResponse.json(matchingTemplates[0]);
    }

    // Otherwise return all MIxS templates
    return NextResponse.json({ templates: allTemplates });
  } catch (error) {
    console.error("Error fetching MIxS templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}
