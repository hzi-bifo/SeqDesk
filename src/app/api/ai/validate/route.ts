import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";

bootstrapRuntimeEnv();

function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

function parseModulesConfig(configString: string | null): ModulesConfig {
  if (!configString) {
    return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
  }

  try {
    const parsed = JSON.parse(configString);
    if (typeof parsed.modules === "object") {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed.modules },
        globalDisabled: parsed.globalDisabled ?? false,
      };
    }
    return {
      modules: { ...DEFAULT_MODULE_STATES, ...parsed },
      globalDisabled: false,
    };
  } catch {
    return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
  }
}

function isModuleEnabled(config: ModulesConfig, moduleId: string): boolean {
  if (config.globalDisabled) return false;
  return config.modules[moduleId] ?? false;
}

// Helper to check if AI module is enabled
async function isAIModuleEnabled(): Promise<boolean> {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const config = parseModulesConfig(settings?.modulesConfig ?? null);
    return isModuleEnabled(config, "ai-validation");
  } catch {
    return true; // Default to enabled on error
  }
}

interface ValidationRequest {
  value: string;
  fieldLabel: string;
  prompt: string;
  strictness?: "lenient" | "moderate" | "strict";
}

interface ValidationResult {
  valid: boolean;
  message: string;
  suggestion?: string;
}

// Tool definition for structured output
const validationTool = {
  name: "validation_result",
  description: "Returns the validation result for a form field input",
  input_schema: {
    type: "object" as const,
    properties: {
      valid: {
        type: "boolean",
        description: "Whether the input is valid according to the field requirements",
      },
      message: {
        type: "string",
        description: "Brief explanation of the validation result (1 sentence)",
      },
      suggestion: {
        type: "string",
        description: "Optional suggestion for improvement if the input is invalid",
      },
    },
    required: ["valid", "message"],
  },
};

export async function POST(request: NextRequest) {
  try {
    const body: ValidationRequest = await request.json();
    const { value, fieldLabel, prompt, strictness = "moderate" } = body;

    if (!value || !prompt) {
      return NextResponse.json(
        { error: "Value and prompt are required" },
        { status: 400 }
      );
    }

    // Check if AI module is enabled
    const moduleEnabled = await isAIModuleEnabled();
    if (!moduleEnabled) {
      return NextResponse.json(
        {
          valid: true,
          message: "AI validation module is disabled",
          moduleDisabled: true,
          configured: false
        },
        { status: 200 }
      );
    }

    // Check if API key is configured
    const anthropicApiKey = getAnthropicApiKey();
    if (!anthropicApiKey) {
      return NextResponse.json(
        {
          valid: true,
          message: "AI validation not configured (no API key)",
          configured: false
        },
        { status: 200 }
      );
    }

    const strictnessInstructions = {
      lenient: "Be lenient and only flag obvious errors or completely invalid entries.",
      moderate: "Apply reasonable validation - allow minor variations but flag clear issues.",
      strict: "Be strict and require the input to closely match the expected format and content.",
    };

    const systemPrompt = `You are a form field validator. Your job is to check if user input is valid based on the field's requirements.

${strictnessInstructions[strictness]}

Use the validation_result tool to return your assessment.`;

    const userPrompt = `Field: "${fieldLabel}"
Expected content: ${prompt}
User entered: "${value}"

Is this a valid entry for this field? Use the validation_result tool to respond.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 256,
        tools: [validationTool],
        tool_choice: { type: "tool", name: "validation_result" },
        messages: [
          { role: "user", content: userPrompt }
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[AI Validate] API error:", errorData);
      return NextResponse.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 }
      );
    }

    const data = await response.json();

    // Find the tool_use block in the response
    const toolUseBlock = data.content?.find(
      (block: { type: string }) => block.type === "tool_use"
    );

    if (toolUseBlock && toolUseBlock.input) {
      const result: ValidationResult = toolUseBlock.input;
      return NextResponse.json({
        valid: result.valid,
        message: result.message,
        suggestion: result.suggestion,
        configured: true,
      });
    }

    // Fallback if no tool use block found (shouldn't happen with tool_choice)
    console.error("[AI Validate] No tool_use block found:", data);
    return NextResponse.json({
      valid: true,
      message: "Could not get structured response",
      configured: true,
    });
  } catch (error) {
    console.error("[AI Validate] Error:", error);
    return NextResponse.json(
      { error: "Failed to validate" },
      { status: 500 }
    );
  }
}

// GET endpoint to check if AI is configured and module is enabled
export async function GET() {
  const moduleEnabled = await isAIModuleEnabled();

  if (!moduleEnabled) {
    return NextResponse.json({
      configured: false,
      moduleDisabled: true,
      message: "AI validation module is disabled",
    });
  }

  return NextResponse.json({
    configured: !!getAnthropicApiKey(),
    moduleDisabled: false,
    message: getAnthropicApiKey()
      ? "AI validation is configured"
      : "Add ANTHROPIC_API_KEY to seqdesk.config.json (runtime.anthropicApiKey) or .env to enable AI validation",
  });
}
