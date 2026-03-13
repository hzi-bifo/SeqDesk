import { ReactNode } from "react";
import { OrderWorkspaceLayout } from "@/components/orders/OrderWorkspaceLayout";

export default async function OrderLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <OrderWorkspaceLayout orderId={id}>{children}</OrderWorkspaceLayout>;
}
