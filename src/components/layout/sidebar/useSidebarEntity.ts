"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";

export interface SidebarEntityData {
  label: string;
  sublabel: string;
  status: string;
}

export interface SidebarEntityContext {
  entityType: "order" | "study" | null;
  entityId: string | null;
  entityData: SidebarEntityData | null;
  isLoading: boolean;
  currentSubPage: string;
}

export function useSidebarEntity(): SidebarEntityContext {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [entityData, setEntityData] = useState<SidebarEntityData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cacheRef = useRef<Record<string, SidebarEntityData>>({});

  // Parse entity context from pathname
  let entityType: "order" | "study" | null = null;
  let entityId: string | null = null;
  let currentSubPage = "overview";

  const orderMatch = pathname.match(/^\/orders\/([^/]+)(\/(.+))?$/);
  const studyMatch = pathname.match(/^\/studies\/([^/]+)(\/(.+))?$/);
  const analysisMatch = pathname.match(/^\/analysis\/([^/]+)/);

  if (orderMatch && orderMatch[1] !== "new") {
    entityType = "order";
    entityId = orderMatch[1];
    currentSubPage = orderMatch[3] || "overview";
  } else if (studyMatch && studyMatch[1] !== "new") {
    entityType = "study";
    entityId = studyMatch[1];
    currentSubPage = studyMatch[3] || "overview";
  } else if (analysisMatch) {
    // On analysis pages, restore sidebar context from query params
    const fromStudy = searchParams.get("studyId");
    const fromOrder = searchParams.get("orderId");
    if (fromStudy) {
      entityType = "study";
      entityId = fromStudy;
      currentSubPage = "pipelines";
    } else if (fromOrder) {
      entityType = "order";
      entityId = fromOrder;
      currentSubPage = "sequencing";
    }
  }

  useEffect(() => {
    if (!entityType || !entityId) {
      setEntityData(null);
      return;
    }

    const cacheKey = `${entityType}:${entityId}`;

    // Use cached data if available
    if (cacheRef.current[cacheKey]) {
      setEntityData(cacheRef.current[cacheKey]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchEntity = async () => {
      try {
        const endpoint =
          entityType === "order"
            ? `/api/orders/${entityId}`
            : `/api/studies/${entityId}`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();

        if (cancelled) return;

        let parsed: SidebarEntityData;
        if (entityType === "order") {
          parsed = {
            label: data.name || data.orderNumber || "Order",
            sublabel: data.orderNumber || "",
            status: data.status || "DRAFT",
          };
        } else {
          parsed = {
            label: data.title || "Study",
            sublabel: data.alias || "",
            status: data.submitted
              ? "PUBLISHED"
              : data.readyForSubmission
                ? "READY"
                : "DRAFT",
          };
        }

        cacheRef.current[cacheKey] = parsed;
        setEntityData(parsed);
      } catch {
        // Silently fail - entity data is non-critical for sidebar
        if (!cancelled) {
          setEntityData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchEntity();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  return {
    entityType,
    entityId,
    entityData,
    isLoading,
    currentSubPage,
  };
}
