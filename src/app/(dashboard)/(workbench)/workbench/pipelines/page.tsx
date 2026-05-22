import { Workflow } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkbenchEmptyPanel, WorkbenchPageHeader, WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";
import { getAllPipelineIds, getPipelineDefinition } from "@/lib/pipelines";

export default function WorkbenchPipelinesPage() {
  const pipelines = getAllPipelineIds()
    .map((id) => getPipelineDefinition(id))
    .filter((pipeline): pipeline is NonNullable<typeof pipeline> => Boolean(pipeline));

  return (
    <PageContainer>
      <WorkbenchPageHeader
        title="Pipelines"
        description="Curated Nextflow packages available for Workbench runs."
        icon={Workflow}
      />

      {pipelines.length === 0 ? (
        <WorkbenchEmptyPanel
          title="No pipeline packages are installed"
          description="Workbench will use the existing SeqDesk pipeline package registry when packages are available."
          icon={Workflow}
          columns={["Pipeline", "Category", "Inputs", "Status"]}
        />
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid border-b border-border bg-secondary/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid-cols-[2fr_1fr_2fr_1fr]">
            <div>Pipeline</div>
            <div className="hidden md:block">Category</div>
            <div className="hidden md:block">Inputs</div>
            <div className="hidden md:block">Status</div>
          </div>
          <div className="divide-y divide-border">
            {pipelines.map((pipeline) => {
              const inputs = [
                pipeline.requires.reads ? "Reads" : null,
                pipeline.requires.assemblies ? "Assemblies" : null,
                pipeline.requires.bins ? "Bins" : null,
                pipeline.requires.checksums ? "Checksums" : null,
                pipeline.requires.sampleMetadata ? "Sample metadata" : null,
              ].filter(Boolean);

              return (
                <div
                  key={pipeline.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[2fr_1fr_2fr_1fr] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{pipeline.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{pipeline.description}</p>
                  </div>
                  <div className="text-sm text-muted-foreground">{pipeline.category}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {inputs.length > 0 ? (
                      inputs.map((input) => (
                        <WorkbenchStatusBadge key={input}>{input}</WorkbenchStatusBadge>
                      ))
                    ) : (
                      <WorkbenchStatusBadge>No strict input</WorkbenchStatusBadge>
                    )}
                  </div>
                  <div>
                    <WorkbenchStatusBadge tone="accent">Catalog</WorkbenchStatusBadge>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </PageContainer>
  );
}
