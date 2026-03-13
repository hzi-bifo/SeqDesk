"use client";

import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";

interface OrderNotesPanelProps {
  orderId: string;
}

export function OrderNotesPanel({ orderId }: OrderNotesPanelProps) {
  return (
    <EntityNotesPanel
      desktopPanelStateKey="order-notes-sidebar-open"
      entityLabel="order"
      fetchUrl={`/api/orders/${orderId}/notes`}
      panelDataAttribute="data-order-notes-panel"
      saveUrl={`/api/orders/${orderId}/notes`}
    />
  );
}
