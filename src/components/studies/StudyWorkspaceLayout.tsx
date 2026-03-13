"use client";

import { type ReactNode } from "react";
import { StudyNotesPanel } from "./StudyNotesPanel";

interface StudyWorkspaceLayoutProps {
  children: ReactNode;
  studyId: string;
}

export function StudyWorkspaceLayout({
  children,
  studyId,
}: StudyWorkspaceLayoutProps) {
  return (
    <div className="min-w-0 xl:flex xl:min-h-[calc(100svh-2.5rem)] xl:items-stretch">
      <div className="min-w-0 flex-1">{children}</div>
      <StudyNotesPanel studyId={studyId} />
    </div>
  );
}
