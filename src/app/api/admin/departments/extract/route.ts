import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";

bootstrapRuntimeEnv();

function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

interface ExtractedDepartment {
  name: string;
  description: string | null;
  isDuplicate?: boolean;
}

// Tool definition for structured output
const extractionTool = {
  name: "department_list",
  description: "Returns a list of extracted departments from webpage content",
  input_schema: {
    type: "object" as const,
    properties: {
      departments: {
        type: "array",
        description: "List of departments found on the webpage",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The official name of the department, research group, or lab",
            },
            description: {
              type: "string",
              description: "Brief description of the department's focus or research area (1-2 sentences max)",
            },
          },
          required: ["name"],
        },
      },
      source_info: {
        type: "string",
        description: "Brief note about what type of page this was (e.g., 'Institute overview page', 'Research groups listing')",
      },
    },
    required: ["departments"],
  },
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Check if API key is configured
    const anthropicApiKey = getAnthropicApiKey();
    if (!anthropicApiKey) {
      return NextResponse.json(
        { error: "AI extraction not configured (no API key)" },
        { status: 503 }
      );
    }

    // Fetch the webpage content
    let pageContent: string;
    try {
      const fetchResponse = await fetch(parsedUrl.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SeqDesk/1.0; Department Importer)",
        },
      });

      if (!fetchResponse.ok) {
        return NextResponse.json(
          { error: `Failed to fetch webpage: ${fetchResponse.status}` },
          { status: 400 }
        );
      }

      const html = await fetchResponse.text();

      // Basic HTML to text conversion - strip tags and clean up
      pageContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15000); // Limit content size
    } catch (fetchError) {
      console.error("[Department Extract] Fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch webpage content" },
        { status: 400 }
      );
    }

    // Use Claude to extract departments
    const systemPrompt = `You are a helpful assistant that extracts department and research group information from institutional webpages.

Extract all departments, research groups, labs, or similar organizational units from the page content.
Focus on research-related units (ignore administrative departments like HR, IT, etc.).
Keep descriptions brief and factual.

Use the department_list tool to return your findings.`;

    const userPrompt = `Extract departments and research groups from this webpage content.

URL: ${parsedUrl.toString()}

Page content:
${pageContent}

Find all departments, research groups, or labs mentioned. Return them using the department_list tool.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 2048,
        tools: [extractionTool],
        tool_choice: { type: "tool", name: "department_list" },
        messages: [{ role: "user", content: userPrompt }],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[Department Extract] API error:", errorData);
      return NextResponse.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 }
      );
    }

    const data = await response.json();

    // Find the tool_use block
    const toolUseBlock = data.content?.find(
      (block: { type: string }) => block.type === "tool_use"
    );

    if (!toolUseBlock || !toolUseBlock.input) {
      return NextResponse.json(
        { error: "Failed to extract departments from page" },
        { status: 500 }
      );
    }

    const extracted = toolUseBlock.input;
    const departments: ExtractedDepartment[] = extracted.departments || [];

    // Check for duplicates against existing departments
    const existingDepts = await db.department.findMany({
      select: { name: true },
    });
    const existingNames = new Set(
      existingDepts.map((d) => d.name.toLowerCase().trim())
    );

    const departmentsWithDuplicateCheck = departments.map((dept) => ({
      ...dept,
      isDuplicate: existingNames.has(dept.name.toLowerCase().trim()),
    }));

    return NextResponse.json({
      departments: departmentsWithDuplicateCheck,
      sourceInfo: extracted.source_info || null,
      url: parsedUrl.toString(),
    });
  } catch (error) {
    console.error("[Department Extract] Error:", error);
    return NextResponse.json(
      { error: "Failed to extract departments" },
      { status: 500 }
    );
  }
}
