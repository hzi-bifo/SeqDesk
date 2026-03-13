"use client";

import { useState, useEffect, useRef } from "react";
import type { FormFieldGroup, FormFieldDefinition } from "@/types/form-config";
import { DEFAULT_GROUPS } from "@/types/form-config";
import { buildOrderProgressSteps } from "@/lib/orders/progress-steps";
import {
  computeOrderProgressStepStatuses,
  type OrderProgressCompletionStatus,
  type OrderProgressStatusOrder,
} from "@/lib/orders/progress-status";
import {
  buildFacilityFieldSections,
  type FacilityFieldSection,
} from "@/lib/orders/facility-sections";

export interface OrderFormStep {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  status?: OrderProgressCompletionStatus;
}

interface FormSchemaResponse {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  enabledMixsChecklists?: string[];
}

interface CachedOrderNavData {
  steps: OrderFormStep[];
  facilitySections: FacilityFieldSection[];
}

/**
 * Fetches the form schema and builds the list of dynamic order wizard steps.
 * Mirrors the exact `buildSteps()` logic from the order creation wizard so the
 * sidebar shows the same steps the user sees when creating/editing an order.
 */
export function useOrderFormSteps(
  includeFacilityFields = false,
  orderId?: string | null
) {
  const [steps, setSteps] = useState<OrderFormStep[]>([]);
  const [facilitySections, setFacilitySections] = useState<FacilityFieldSection[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<Record<string, CachedOrderNavData>>({});

  useEffect(() => {
    if (!orderId) {
      setSteps([]);
      setLoading(false);
      return;
    }

    const cacheKey = `${orderId}:${includeFacilityFields ? "facility" : "default"}`;
    if (cacheRef.current[cacheKey]) {
      setSteps(cacheRef.current[cacheKey].steps.map((step) => ({
        ...step,
        status: "empty",
      })));
      setFacilitySections(cacheRef.current[cacheKey].facilitySections.map((section) => ({
        ...section,
        status: "empty",
      })));
    }

    let cancelled = false;

    const fetchSchema = async () => {
      try {
        const [schemaRes, orderRes] = await Promise.all([
          fetch("/api/form-schema"),
          fetch(`/api/orders/${orderId}`),
        ]);
        if (!schemaRes.ok) throw new Error("Failed to fetch form schema");
        if (!orderRes.ok) throw new Error("Failed to fetch order");

        const [data, orderData]: [FormSchemaResponse, OrderProgressStatusOrder] = await Promise.all([
          schemaRes.json(),
          orderRes.json(),
        ]);

        if (cancelled) return;

        const builtSteps = buildOrderProgressSteps({
          fields: data.fields || [],
          groups: data.groups || DEFAULT_GROUPS,
          enabledMixsChecklists: data.enabledMixsChecklists || [],
          includeFacilityFields,
        });
        const stepStatuses = computeOrderProgressStepStatuses({
          fields: data.fields || [],
          groups: data.groups || DEFAULT_GROUPS,
          order: orderData,
          enabledMixsChecklists: data.enabledMixsChecklists || [],
          includeFacilityFields,
        });
        const built = builtSteps.map((step) => ({
          id: step.id,
          label: step.label,
          description: step.description,
          icon: step.icon,
          status: stepStatuses[step.id] || "empty",
        }));
        const builtFacilitySections = buildFacilityFieldSections({
          fields: data.fields || [],
          order: orderData,
          includeFacilityFields,
        });

        cacheRef.current[cacheKey] = {
          steps: built,
          facilitySections: builtFacilitySections,
        };
        setSteps(built);
        setFacilitySections(builtFacilitySections);
      } catch {
        // On error, fall back to default steps so sidebar always shows something
        if (!cancelled) {
          const fallback: OrderFormStep[] = [
            { id: "group_details", label: "Order Details", icon: "FileText", status: "empty" },
            { id: "group_sequencing", label: "Sequencing Information", icon: "Settings", status: "empty" },
            { id: "samples", label: "Samples", icon: "Table", status: "empty" },
            { id: "review", label: "Review", icon: "CheckCircle2", status: "empty" },
          ];
          cacheRef.current[cacheKey] = {
            steps: fallback,
            facilitySections: [],
          };
          setSteps(fallback);
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
  }, [includeFacilityFields, orderId]);

  return { steps, facilitySections, loading };
}
