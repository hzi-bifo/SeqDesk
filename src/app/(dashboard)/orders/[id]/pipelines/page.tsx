import { redirect } from "next/navigation";

function firstSearchValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrderPipelinesRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const pipelineId = firstSearchValue(resolvedSearchParams.pipeline);

  if (pipelineId) {
    redirect(`/orders/${id}/sequencing?pipeline=${encodeURIComponent(pipelineId)}`);
  }

  redirect(`/orders/${id}/sequencing?view=analysis`);
}
