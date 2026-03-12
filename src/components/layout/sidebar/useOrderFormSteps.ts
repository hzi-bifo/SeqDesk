"use client";

import { useState, useEffect, useRef } from "react";
import type { FormFieldGroup, FormFieldDefinition } from "@/types/form-config";
import { DEFAULT_GROUPS } from "@/types/form-config";

export interface OrderFormStep {
  id: string;
  label: string;
  description?: string;
  icon?: string;
}

interface FormSchemaResponse {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  enabledMixsChecklists?: string[];
}

/**
 * Fetches the form schema and builds the list of dynamic order wizard steps.
 * Mirrors the exact `buildSteps()` logic from the order creation wizard so the
 * sidebar shows the same steps the user sees when creating/editing an order.
 */
export function useOrderFormSteps() {
  const [steps, setSteps] = useState<OrderFormStep[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<OrderFormStep[] | null>(null);

  useEffect(() => {
    if (cacheRef.current) {
      setSteps(cacheRef.current);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchSchema = async () => {
      try {
        const res = await fetch("/api/form-schema");
        if (!res.ok) throw new Error("Failed to fetch form schema");
        const data: FormSchemaResponse = await res.json();

        if (cancelled) return;

        const groups = (data.groups || DEFAULT_GROUPS).sort(
          (a, b) => a.order - b.order
        );

        // Mirror the wizard's visibleFields filter:
        // visible + not perSample + not adminOnly
        const visibleFields = (data.fields || []).filter(
          (f) => f.visible && !f.perSample && !f.adminOnly
        );

        const built: OrderFormStep[] = [];

        // 1. Groups with visible non-MIxS fields → each becomes a step
        for (const group of groups) {
          const groupFields = visibleFields.filter(
            (f) => f.groupId === group.id && f.type !== "mixs"
          );
          if (groupFields.length > 0) {
            built.push({
              id: group.id,
              label: group.name,
              description: group.description,
              icon: group.icon,
            });
          }
        }

        // 2. Ungrouped fields → "Additional Details" step
        const ungrouped = visibleFields.filter(
          (f) => !f.groupId && f.type !== "mixs"
        );
        if (ungrouped.length > 0) {
          built.push({
            id: "_ungrouped",
            label: "Additional Details",
            description: "Other order information",
            icon: "ClipboardList",
          });
        }

        // 3. MIxS metadata step (if there's a visible MIxS field)
        const hasMixs =
          visibleFields.some((f) => f.type === "mixs") &&
          (data.enabledMixsChecklists || []).length > 0;
        if (hasMixs) {
          built.push({
            id: "mixs",
            label: "Sample Metadata",
            description: "MIxS environment checklist",
            icon: "Leaf",
          });
        }

        // 4. Samples step (always)
        built.push({
          id: "samples",
          label: "Samples",
          description: "Add your samples to this order",
          icon: "Table",
        });

        // 5. Review step (always)
        built.push({
          id: "review",
          label: "Review",
          description: "Review and submit your order",
          icon: "CheckCircle2",
        });

        cacheRef.current = built;
        setSteps(built);
      } catch {
        // On error, fall back to default steps so sidebar always shows something
        if (!cancelled) {
          const fallback: OrderFormStep[] = [
            { id: "group_details", label: "Order Details", icon: "FileText" },
            { id: "group_sequencing", label: "Sequencing Parameters", icon: "Settings" },
            { id: "samples", label: "Samples", icon: "Table" },
            { id: "review", label: "Review", icon: "CheckCircle2" },
          ];
          cacheRef.current = fallback;
          setSteps(fallback);
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
  }, []);

  return { steps, loading };
}
