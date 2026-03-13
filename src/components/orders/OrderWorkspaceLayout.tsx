"use client";

import { ReactNode } from "react";
import { OrderNotesPanel } from "./OrderNotesPanel";

interface OrderWorkspaceLayoutProps {
  children: ReactNode;
  orderId: string;
}

export function OrderWorkspaceLayout({
  children,
  orderId,
}: OrderWorkspaceLayoutProps) {
  return (
    <div className="min-w-0 xl:flex xl:min-h-[calc(100svh-2.5rem)] xl:items-stretch">
      <div className="min-w-0 flex-1">{children}</div>
      <OrderNotesPanel orderId={orderId} />
    </div>
  );
}
