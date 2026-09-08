import { PageContainer } from "@/components/layout/PageContainer";
import { SequencingDataImportFlow } from "@/components/orders/SequencingDataImportFlow";
import { inputModuleEnabled } from "@/lib/modules/input-modules.server";

export default async function ImportDataPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  const selected = source === "cami" || source === "sra" ? source : undefined;
  const enabled = selected ? await inputModuleEnabled(selected === "cami" ? "import-cami" : "import-sra") : true;
  return <PageContainer><SequencingDataImportFlow moduleEnabled={enabled} /></PageContainer>;
}
