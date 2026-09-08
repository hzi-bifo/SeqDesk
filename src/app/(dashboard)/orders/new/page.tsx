"use client";

import { OrderWizardPage } from "@/app/(dashboard)/orders/order-wizard-page";
import { useSearchParams } from "next/navigation";
import { useModuleEnabled } from "@/lib/modules";
import { PageContainer } from "@/components/layout/PageContainer";
import { SequencingDataImportFlow } from "@/components/orders/SequencingDataImportFlow";

export default function NewOrderPage() {
  const source = useSearchParams().get("source");
  const facility = useModuleEnabled("sequencing-management");
  if (source === "facility" && facility) return <OrderWizardPage />;
  return <PageContainer><SequencingDataImportFlow newEntry /></PageContainer>;
}
