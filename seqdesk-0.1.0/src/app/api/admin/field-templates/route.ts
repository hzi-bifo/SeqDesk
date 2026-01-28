import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

export interface FieldTemplate {
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
    placeholder?: string;
    helpText?: string;
    example?: string;
    options?: Array<{ value: string; label: string }>;
    simpleValidation?: {
      minLength?: number;
      maxLength?: number;
      minValue?: number;
      maxValue?: number;
      pattern?: string;
      patternPreset?: string;
      patternMessage?: string;
    };
    aiValidation?: {
      enabled: boolean;
      prompt: string;
      strictness?: string;
    };
  }>;
}

// GET all field templates from JSON files
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templatesDir = path.join(process.cwd(), "data", "field-templates");

    // Check if directory exists
    if (!fs.existsSync(templatesDir)) {
      return NextResponse.json({
        templates: [],
        message: "No field templates directory found",
      });
    }

    // Read all JSON files in the directory
    const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));

    const templates: FieldTemplate[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(templatesDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const template = JSON.parse(content) as FieldTemplate;
        templates.push(template);
      } catch (err) {
        console.error(`Error parsing ${file}:`, err);
        // Skip invalid files
      }
    }

    // Sort templates: general first, then alphabetically by name
    templates.sort((a, b) => {
      if (a.category !== b.category) {
        if (!a.category) return -1;
        if (!b.category) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Error loading field templates:", error);
    return NextResponse.json(
      { error: "Failed to load field templates" },
      { status: 500 }
    );
  }
}
