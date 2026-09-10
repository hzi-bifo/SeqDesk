"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * A short note a page can show in the footer, next to the clock: "Last changed …", a record count, and so on.
 * It lives in the footer so the page itself stays free of housekeeping lines.
 */
const FooterNoteContext = createContext<{ note: string | null; setNote: (note: string | null) => void } | null>(null);

export function FooterNoteProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<string | null>(null);
  return <FooterNoteContext.Provider value={{ note, setNote }}>{children}</FooterNoteContext.Provider>;
}

/** The note currently set by the page, or null. */
export function useFooterNoteValue(): string | null {
  return useContext(FooterNoteContext)?.note ?? null;
}

/** Show `note` in the footer while the calling component is mounted; pass null to show nothing. */
export function useFooterNote(note: string | null) {
  const context = useContext(FooterNoteContext);
  const setNote = context?.setNote;
  useEffect(() => {
    if (!setNote) return;
    setNote(note);
    return () => setNote(null);
  }, [note, setNote]);
}
