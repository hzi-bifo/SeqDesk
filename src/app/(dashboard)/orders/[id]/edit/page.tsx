"use client";

import { use, useEffect, useState } from "react";
import { ImportedMetadataEditor, type ImportedEditableData } from "@/components/orders/ImportedMetadataEditor";

import { OrderWizardPage } from "@/app/(dashboard)/orders/order-wizard-page";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [record, setRecord] = useState<(ImportedEditableData & { dataOrigin?: string }) | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/orders/${resolvedParams.id}`).then(async r => {
      if (!r.ok) throw new Error("Sequencing data is unavailable");
      const result = await r.json(); if (active) setRecord(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [resolvedParams.id]);

  if (error) return <p className="p-8" role="alert">{error}</p>;
  if (!record) return <p className="p-8">Loading sequencing metadata…</p>;
  if (record.dataOrigin === "import") return <ImportedMetadataEditor key={record.id} initial={record} />;

  return <OrderWizardPage forcedEditOrderId={resolvedParams.id} />;
}
