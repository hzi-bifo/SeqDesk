"use client";

import { TechnologySelector } from "@/components/forms/fields/TechnologySelector";
import { FormFieldDefinition } from "@/types/form-config";
import { SequencingTechSelection } from "@/types/sequencing-technology";

interface SequencingTechFormRendererProps {
  field: FormFieldDefinition;
  value: SequencingTechSelection | string | undefined;
  onChange: (value: SequencingTechSelection | undefined) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Form renderer component for Sequencing Technology field type.
 * Shows the TechnologySelector card-based UI in the order form.
 */
export function SequencingTechFormRenderer({
  field,
  value,
  onChange,
  error,
  disabled,
}: SequencingTechFormRendererProps) {
  return (
    <div className="space-y-2">
      <TechnologySelector
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {field.helpText && !error && (
        <p className="text-sm text-muted-foreground">{field.helpText}</p>
      )}
    </div>
  );
}
