"use client";

import type { FormFieldDefinition } from "@/types/form-config";
import { cn } from "@/lib/utils";

interface InlineFieldHelpProps {
  field: Pick<FormFieldDefinition, "helpText" | "placeholder" | "example">;
  active?: boolean;
  hidden?: boolean;
  gap?: "sm" | "md";
  className?: string;
}

function normalizeExample(example: string) {
  return example.replace(/^\s*(?:e\.g\.|eg\.?)\s*,?\s*/i, "").trim();
}

export function hasInlineFieldHelpContent(
  field: Pick<FormFieldDefinition, "helpText" | "placeholder" | "example">
) {
  const exampleSource = field.example || field.placeholder;
  return Boolean(field.helpText || (exampleSource && normalizeExample(exampleSource)));
}

export function InlineFieldHelp({
  field,
  active = true,
  hidden = false,
  gap = "md",
  className,
}: InlineFieldHelpProps) {
  const exampleSource = field.example || field.placeholder;
  const example = exampleSource ? normalizeExample(exampleSource) : "";
  const attachedMargin = gap === "sm" ? "-5px" : "-9px";

  if (hidden || !active || (!field.helpText && !example)) return null;

  return (
    <div
      data-testid="inline-field-help"
      className={cn(
        "relative z-0 rounded-b-lg rounded-t-none border border-zinc-300 bg-zinc-50 px-3 py-2",
        className
      )}
      style={{ marginBlockStart: attachedMargin }}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-500"
        />
        <div className="space-y-0.5">
          {field.helpText && (
            <p className="text-xs font-medium text-zinc-600">
              {field.helpText}
            </p>
          )}
          {example && (
            <p className="text-xs text-zinc-500">
              Example: {example}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
