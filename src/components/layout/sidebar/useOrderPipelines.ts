"use client";

import { useEntityPipelines, type EntityPipelineNavItem } from "./useEntityPipelines";

export type OrderPipelineNavItem = EntityPipelineNavItem;
export { getPipelineProgressStatuses as getOrderPipelineProgressStatuses } from "./pipelineProgress";

/** Fetch enabled order pipelines, current input compatibility, and independent run status. */
export function useOrderPipelines(
  showAdminControls: boolean,
  orderId: string | null,
  enablePolling = true
): OrderPipelineNavItem[] {
  return useEntityPipelines("order", showAdminControls, orderId, enablePolling);
}
