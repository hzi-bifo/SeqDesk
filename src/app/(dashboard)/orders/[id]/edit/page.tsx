"use client";

import { use } from "react";

import { OrderWizardPage } from "@/app/(dashboard)/orders/order-wizard-page";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);

  return <OrderWizardPage forcedEditOrderId={resolvedParams.id} />;
}
