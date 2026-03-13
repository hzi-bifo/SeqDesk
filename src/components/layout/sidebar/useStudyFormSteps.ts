"use client";

import { useEffect, useRef, useState } from "react";
import type { FormFieldDefinition } from "@/types/form-config";
import {
  buildStudyFacilityFieldSections,
  type StudyFacilityFieldSection,
} from "@/lib/studies/facility-sections";
import {
  buildStudyOverviewFlowSections,
  type StudyOverviewFlowSection,
} from "@/lib/studies/overview-flow";

interface StudyFormSchemaResponse {
  fields?: FormFieldDefinition[];
  perSampleFields?: FormFieldDefinition[];
  modules?: {
    mixs?: boolean;
    sampleAssociation?: boolean;
  };
}

interface StudyNavStudy {
  title: string;
  description: string | null;
  alias: string | null;
  checklistType: string | null;
  studyMetadata: string | null;
  readyForSubmission?: boolean;
  submitted?: boolean;
  samples: Array<{
    id: string;
    sampleAlias?: string | null;
    sampleTitle?: string | null;
    taxId?: string | null;
    scientificName?: string | null;
    checklistData: string | null;
    customFields?: string | null;
  }>;
}

interface CachedStudyNavData {
  overviewSections: StudyOverviewFlowSection[];
  facilitySections: StudyFacilityFieldSection[];
}

export function useStudyFormSteps(
  includeFacilityFields = false,
  studyId?: string | null
) {
  const [overviewSections, setOverviewSections] = useState<StudyOverviewFlowSection[]>([]);
  const [facilitySections, setFacilitySections] = useState<StudyFacilityFieldSection[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<Record<string, CachedStudyNavData>>({});

  useEffect(() => {
    if (!studyId) {
      setOverviewSections([]);
      setFacilitySections([]);
      setLoading(false);
      return;
    }

    const cacheKey = `${studyId}:${includeFacilityFields ? "facility" : "default"}`;
    if (cacheRef.current[cacheKey]) {
      setOverviewSections(cacheRef.current[cacheKey].overviewSections);
      setFacilitySections(cacheRef.current[cacheKey].facilitySections);
    }

    let cancelled = false;

    const fetchSchema = async () => {
      try {
        const [schemaRes, studyRes] = await Promise.all([
          fetch("/api/study-form-schema"),
          fetch(`/api/studies/${studyId}`),
        ]);
        if (!schemaRes.ok) throw new Error("Failed to fetch study form schema");
        if (!studyRes.ok) throw new Error("Failed to fetch study");

        const [schemaData, studyData]: [StudyFormSchemaResponse, StudyNavStudy] =
          await Promise.all([schemaRes.json(), studyRes.json()]);
        if (cancelled) return;

        const fields = schemaData.fields || [];
        const visibleUserPerSampleFields =
          schemaData.perSampleFields?.filter(
            (field) => field.visible !== false && !field.adminOnly
          ) || [];
        const includeAssociatedSamples =
          Boolean(schemaData.modules?.sampleAssociation) || studyData.samples.length > 0;
        const includeEnvironmentType =
          Boolean(schemaData.modules?.mixs) || Boolean(studyData.checklistType);
        const includeSampleMetadata =
          includeAssociatedSamples &&
          (visibleUserPerSampleFields.length > 0 || includeEnvironmentType);

        const builtOverviewSections = buildStudyOverviewFlowSections({
          fields,
          study: studyData,
          includeAssociatedSamples,
          includeEnvironmentType,
          includeSampleMetadata,
        });
        const builtFacilitySections = buildStudyFacilityFieldSections({
          fields,
          study: studyData,
          includeFacilityFields,
        });

        cacheRef.current[cacheKey] = {
          overviewSections: builtOverviewSections,
          facilitySections: builtFacilitySections,
        };
        setOverviewSections(builtOverviewSections);
        setFacilitySections(builtFacilitySections);
      } catch {
        if (!cancelled) {
          cacheRef.current[cacheKey] = {
            overviewSections: buildStudyOverviewFlowSections({
              fields: [],
              study: {
                title: "",
                description: null,
                alias: null,
                checklistType: null,
                studyMetadata: null,
                samples: [],
                readyForSubmission: false,
                submitted: false,
              },
              includeAssociatedSamples: true,
              includeEnvironmentType: false,
              includeSampleMetadata: false,
            }),
            facilitySections: [],
          };
          setOverviewSections(cacheRef.current[cacheKey].overviewSections);
          setFacilitySections([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchSchema();
    return () => {
      cancelled = true;
    };
  }, [includeFacilityFields, studyId]);

  return { overviewSections, facilitySections, loading };
}
