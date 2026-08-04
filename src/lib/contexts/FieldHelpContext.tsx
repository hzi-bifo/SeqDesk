"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FormFieldDefinition } from "@/types/form-config";

interface FieldHelpContextType {
  focusedField: FormFieldDefinition | null;
  setFocusedField: (field: FormFieldDefinition | null) => void;
  validationError: string | null;
  setValidationError: (error: string | null) => void;
}

const FieldHelpContext = createContext<FieldHelpContextType | undefined>(undefined);

export function FieldHelpProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [statePathname, setStatePathname] = useState(pathname);
  const [focusedField, setFocusedField] = useState<FormFieldDefinition | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset page-specific help before rendering the new route. Keeping the
  // provider instance stable avoids remounting the persistent dashboard shell.
  if (statePathname !== pathname) {
    setStatePathname(pathname);
    setFocusedField(null);
    setValidationError(null);
  }

  return (
    <FieldHelpContext.Provider value={{ focusedField, setFocusedField, validationError, setValidationError }}>
      {children}
    </FieldHelpContext.Provider>
  );
}

export function useFieldHelp() {
  const context = useContext(FieldHelpContext);
  if (context === undefined) {
    throw new Error("useFieldHelp must be used within a FieldHelpProvider");
  }
  return context;
}
