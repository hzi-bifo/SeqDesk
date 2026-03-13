"use client";

import { Lightbulb, X } from "lucide-react";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";

export function SidebarFieldHelp() {
  const { focusedField, setFocusedField, validationError } = useFieldHelp();

  if (!focusedField) return null;

  return (
    <div>
      <div
        className="relative p-3 rounded-lg overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(247, 247, 244, 0.9) 0%, rgba(239, 239, 233, 0.95) 50%, rgba(247, 247, 244, 0.9) 100%)",
          border: "1px solid #e5e5e0",
        }}
      >
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div
                className="h-5 w-5 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #171717 0%, #525252 100%)",
                }}
              >
                <Lightbulb className="h-3 w-3 text-white" />
              </div>
              <span className="text-xs font-semibold text-foreground tracking-wide">
                Field Help
              </span>
            </div>
            <button
              onClick={() => setFocusedField(null)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            {focusedField.label}
            {focusedField.required && (
              <span className="text-red-500 ml-1">*</span>
            )}
          </p>
          {validationError && (
            <div className="mb-2 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {validationError}
              </p>
            </div>
          )}
          {focusedField.helpText && (
            <p className="text-xs text-muted-foreground mb-2">
              {focusedField.helpText}
            </p>
          )}
          {(focusedField.placeholder || focusedField.example) && (
            <p className="text-xs text-muted-foreground/70">
              Example: {focusedField.placeholder || focusedField.example}
            </p>
          )}
          {focusedField.units &&
            Array.isArray(focusedField.units) &&
            focusedField.units.length > 0 && (
              <p className="text-xs text-muted-foreground/70 mt-1">
                Unit:{" "}
                {focusedField.units
                  .map((u: { label: string }) => u.label)
                  .join(", ")}
              </p>
            )}
          {focusedField.type === "select" &&
            focusedField.options &&
            focusedField.options.length > 0 &&
            focusedField.options.length <= 10 && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  Options:
                </p>
                <ul className="text-xs text-muted-foreground/70 space-y-0.5">
                  {focusedField.options.map(
                    (opt: { value: string; label: string }) => (
                      <li key={opt.value}>{opt.label}</li>
                    )
                  )}
                </ul>
              </div>
            )}
          {focusedField.type === "select" &&
            focusedField.options &&
            focusedField.options.length > 10 && (
              <p className="text-xs text-muted-foreground/70 mt-1">
                {focusedField.options.length} options available
              </p>
            )}
          {focusedField.simpleValidation &&
            (() => {
              const v = focusedField.simpleValidation;
              const hasMinMax =
                v.minLength ||
                v.maxLength ||
                v.minValue !== undefined ||
                v.maxValue !== undefined;
              const isPatternMessageUseful =
                v.patternMessage &&
                !v.patternMessage.startsWith("Must match pattern:") &&
                !v.patternMessage.includes("^[") &&
                !v.patternMessage.includes("\\d") &&
                !v.patternMessage.includes("\\w");
              const hasPattern = !!v.pattern;

              let patternDescription = "";
              if (hasPattern && v.pattern) {
                if (
                  v.pattern.includes("ISO8601") ||
                  v.pattern.includes("[12][0-9]{3}")
                ) {
                  patternDescription =
                    "ISO 8601 date format (e.g., 2024-01-15 or 2024-01)";
                } else if (
                  v.pattern.includes("@") ||
                  v.pattern.includes("email")
                ) {
                  patternDescription = "Email address format";
                } else if (
                  v.pattern.includes("http") ||
                  v.pattern.includes("url")
                ) {
                  patternDescription = "URL format (http:// or https://)";
                } else if (
                  v.pattern.includes("not collected") ||
                  v.pattern.includes("not provided")
                ) {
                  patternDescription = "Accepts standard missing value terms";
                } else if (
                  v.pattern.match(/^\^?\[0-9\]/) ||
                  v.pattern.includes("[Ee][+-]")
                ) {
                  patternDescription = "Numeric value (decimal allowed)";
                }
              }

              if (!hasMinMax && !isPatternMessageUseful && !patternDescription) {
                if (hasPattern) {
                  return (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground font-medium mb-1">
                        Validation:
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        Input will be validated on entry
                      </p>
                    </div>
                  );
                }
                return null;
              }

              return (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[10px] text-muted-foreground font-medium mb-1 font-geist-pixel">
                    Format:
                  </p>
                  <ul className="text-[10px] text-muted-foreground/70 space-y-0.5 font-geist-pixel">
                    {v.minLength && (
                      <li>Min length: {v.minLength} characters</li>
                    )}
                    {v.maxLength && (
                      <li>Max length: {v.maxLength} characters</li>
                    )}
                    {v.minValue !== undefined && (
                      <li>Min value: {v.minValue}</li>
                    )}
                    {v.maxValue !== undefined && (
                      <li>Max value: {v.maxValue}</li>
                    )}
                    {isPatternMessageUseful && <li>{v.patternMessage}</li>}
                    {patternDescription && <li>{patternDescription}</li>}
                  </ul>
                </div>
              );
            })()}
          {focusedField.perSample && (
            <div className="mt-2 pt-2 border-t border-border">
              <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                Per-Sample Field
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
