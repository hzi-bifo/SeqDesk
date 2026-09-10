"use client";

import { OrderWizardPage } from "@/app/(dashboard)/orders/order-wizard-page";
import { useSearchParams } from "next/navigation";
import { useModuleEnabled } from "@/lib/modules";
import { PageContainer } from "@/components/layout/PageContainer";
import { SequencingDataImportFlow } from "@/components/orders/SequencingDataImportFlow";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NewOrderPage() {
  const source = useSearchParams().get("source");
  const facility = useModuleEnabled("sequencing-management");
  if (source === "facility" && facility) return <OrderWizardPage />;
  return <PageContainer>
    {source === "facility" && !facility && <p role="alert" className="mb-4 text-sm text-muted-foreground">Facility sequencing is not enabled for this installation.</p>}
    <SequencingDataImportFlow newEntry />
    {facility && <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5">
      <p className="text-sm text-muted-foreground">Need the facility to sequence your samples?</p>
      <Button variant="outline" size="sm" asChild><Link href="/orders/new?source=facility">Request sequencing</Link></Button>
    </div>}
  </PageContainer>;
}
