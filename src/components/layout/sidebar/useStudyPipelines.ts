"use client";

import { useEntityPipelines, type EntityPipelineNavItem } from "./useEntityPipelines";

export type StudyPipelineNavItem = EntityPipelineNavItem;

export function useStudyPipelines(
  showAdminControls: boolean,
  studyId: string | null,
  enablePolling = true
): StudyPipelineNavItem[] {
  return useEntityPipelines("study", showAdminControls, studyId, enablePolling);
}
