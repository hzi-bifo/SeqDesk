"use client";

import { use } from "react";
import { OrderFilesClient } from "@/components/orders/OrderFilesClient";

export default function SamplesFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrderFilesClient key={id} orderId={id} />;
}
