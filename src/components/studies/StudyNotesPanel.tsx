"use client";

import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";

interface StudyNotesPanelProps {
  studyId: string;
}

export function StudyNotesPanel({ studyId }: StudyNotesPanelProps) {
  return (
    <EntityNotesPanel
      desktopPanelStateKey="study-notes-sidebar-open"
      entityLabel="study"
      fetchUrl={`/api/studies/${studyId}`}
      panelDataAttribute="data-study-notes-panel"
      saveUrl={`/api/studies/${studyId}`}
    />
  );
}
