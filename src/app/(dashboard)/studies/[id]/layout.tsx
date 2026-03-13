import { type ReactNode } from "react";
import { StudyWorkspaceLayout } from "@/components/studies/StudyWorkspaceLayout";

export default async function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <StudyWorkspaceLayout studyId={id}>{children}</StudyWorkspaceLayout>;
}
