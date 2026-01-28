"use client";

import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Check,
  Clock,
  Code,
  Database,
  FileInput,
  FileOutput,
  HardDrive,
  Layers,
  Table,
} from "lucide-react";

interface SamplesheetColumn {
  name: string;
  source: string | null;
  required?: boolean;
  default?: string;
  filters?: Record<string, unknown>;
  transform?: {
    type: string;
    base?: string;
    mapping?: Record<string, string>;
  };
  description?: string;
}

interface SamplesheetConfig {
  format: "csv" | "tsv";
  filename: string;
  rows: {
    scope: string;
  };
  columns: SamplesheetColumn[];
}

interface PipelineInput {
  id: string;
  name: string;
  description?: string;
  fileTypes?: string[];
  source?: string;
  sourceDescription?: string;
}

interface PipelineOutput {
  id: string;
  name: string;
  description?: string;
  fromStep?: string;
  fileTypes?: string[];
  destination?: string;
  destinationField?: string;
  destinationDescription?: string;
  integrationStatus?: "implemented" | "partial" | "planned";
  _implementationNote?: string;
  _designNote?: string;
}

interface PipelineIntegrationDetailsProps {
  pipelineName: string;
  pipelineId: string;
  samplesheet?: SamplesheetConfig;
  inputs: PipelineInput[];
  outputs: PipelineOutput[];
}

function getSourceDescription(source: string | null): {
  table: string;
  field: string;
  description: string;
} {
  if (!source) {
    return {
      table: "-",
      field: "-",
      description: "Manual/default value",
    };
  }

  const mappings: Record<string, { table: string; field: string; description: string }> = {
    "sample.sampleId": {
      table: "Sample",
      field: "sampleId",
      description: "Unique sample identifier",
    },
    "read.file1": {
      table: "Read",
      field: "file1",
      description: "Forward reads file path (R1)",
    },
    "read.file2": {
      table: "Read",
      field: "file2",
      description: "Reverse reads file path (R2)",
    },
    "sample.reads[paired].file1": {
      table: "Read",
      field: "file1",
      description: "Forward reads file path (R1)",
    },
    "sample.reads[paired].file2": {
      table: "Read",
      field: "file2",
      description: "Reverse reads file path (R2)",
    },
    "sample.reads[single].file1": {
      table: "Read",
      field: "file1",
      description: "Single-end reads file path",
    },
    "sample.reads[long].file1": {
      table: "Read",
      field: "file1",
      description: "Long reads file path",
    },
    "study.id": {
      table: "Study",
      field: "id",
      description: "Study identifier (used for grouping)",
    },
    "study.title": {
      table: "Study",
      field: "title",
      description: "Study title",
    },
    "order.platform": {
      table: "Order",
      field: "platform",
      description: "Sequencing platform (ILLUMINA, etc.)",
    },
    "order.libraryStrategy": {
      table: "Order",
      field: "libraryStrategy",
      description: "Library strategy (WGS, RNA-seq, etc.)",
    },
  };

  return mappings[source] || {
    table: "Unknown",
    field: source,
    description: source,
  };
}

function getDestinationDescription(destination: string): {
  table: string;
  description: string;
  implemented: boolean;
} {
  const mappings: Record<string, { table: string; description: string; implemented: boolean }> = {
    sample_assemblies: {
      table: "Assembly",
      description: "Creates Assembly records linked to samples",
      implemented: true,
    },
    sample_bins: {
      table: "Bin",
      description: "Creates Bin records linked to assemblies",
      implemented: true,
    },
    sample_qc: {
      table: "Sample",
      description: "Updates sample QC status fields",
      implemented: false,
    },
    sample_metadata: {
      table: "Sample",
      description: "Updates sample metadata fields",
      implemented: false,
    },
    sample_annotations: {
      table: "PipelineArtifact",
      description: "Stores annotation files as artifacts",
      implemented: false,
    },
    order_report: {
      table: "PipelineArtifact",
      description: "Links report to the study/order",
      implemented: true,
    },
    download_only: {
      table: "-",
      description: "Available for download, not stored in DB",
      implemented: true,
    },
  };

  return mappings[destination] || {
    table: "Unknown",
    description: destination,
    implemented: false,
  };
}

export function PipelineIntegrationDetails({
  pipelineName,
  pipelineId,
  samplesheet,
  inputs,
  outputs,
}: PipelineIntegrationDetailsProps) {
  return (
    <div className="space-y-8">
      {/* Section 1: Samplesheet Generation */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
            <Table className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Samplesheet Generation</h3>
            <p className="text-sm text-muted-foreground">
              How SeqDesk creates the input CSV for {pipelineName}
            </p>
          </div>
          <Badge className="ml-auto bg-green-100 text-green-700 border-green-200">
            <Check className="h-3 w-3 mr-1" />
            Implemented
          </Badge>
        </div>

        {samplesheet && samplesheet.columns.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">CSV Column</th>
                  <th className="text-left p-3 font-medium">SeqDesk Source</th>
                  <th className="text-left p-3 font-medium">DB Table.Field</th>
                  <th className="text-left p-3 font-medium">Required</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {samplesheet.columns.map((col) => {
                  const sourceInfo = getSourceDescription(col.source);
                  return (
                    <tr key={col.name} className="hover:bg-muted/30">
                      <td className="p-3">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {col.name}
                        </code>
                      </td>
                      <td className="p-3">
                        <code className="text-xs text-blue-600">{col.source ?? "manual"}</code>
                        {col.transform && (
                          <span className="text-xs text-muted-foreground ml-2">
                            → {col.transform.type}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        <span className="font-medium text-foreground">{sourceInfo.table}</span>
                        .{sourceInfo.field}
                      </td>
                      <td className="p-3">
                        {col.required ? (
                          <Badge variant="outline" className="text-xs">Required</Badge>
                        ) : col.default !== undefined ? (
                          <span className="text-xs text-muted-foreground">
                            Default: "{col.default}"
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Optional</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          </div>
        ) : (
          <div className="p-4 border rounded-lg bg-muted/30 text-sm text-muted-foreground">
            <Code className="h-4 w-4 inline mr-2" />
            Samplesheet generated via custom adapter code
            <code className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">
              src/lib/pipelines/adapters/{pipelineId}.ts
            </code>
          </div>
        )}
      </section>

      {/* Section 2: Data Inputs */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
            <FileInput className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Data Inputs</h3>
            <p className="text-sm text-muted-foreground">
              What data flows from SeqDesk into the pipeline
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {inputs.map((input) => (
            <div
              key={input.id}
              className="flex items-center gap-4 p-3 border rounded-lg bg-blue-50/30"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{input.name}</span>
                  {input.fileTypes && input.fileTypes.length > 0 && (
                    <div className="flex gap-1">
                      {input.fileTypes.map((ft) => (
                        <code key={ft} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          .{ft}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{input.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="text-right">
                <code className="text-xs text-blue-600">{input.source}</code>
                <p className="text-xs text-muted-foreground">{input.sourceDescription}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Data Outputs */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
            <FileOutput className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Data Outputs</h3>
            <p className="text-sm text-muted-foreground">
              What results flow back from the pipeline into SeqDesk
            </p>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Output</th>
                <th className="text-left p-3 font-medium">From Step</th>
                <th className="text-left p-3 font-medium">Destination</th>
                <th className="text-left p-3 font-medium">DB Table</th>
                <th className="text-left p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {outputs.map((output) => {
                const destInfo = getDestinationDescription(output.destination || "download_only");
                const status = output.integrationStatus || (destInfo.implemented ? "implemented" : "planned");
                const note = output._implementationNote || output._designNote;

                return (
                  <tr key={output.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <div className="font-medium">{output.name}</div>
                      {output.fileTypes && (
                        <div className="flex gap-1 mt-1">
                          {output.fileTypes.slice(0, 3).map((ft) => (
                            <code key={ft} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                              .{ft}
                            </code>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {output.fromStep}
                      </code>
                    </td>
                    <td className="p-3">
                      <code className="text-xs text-emerald-600">{output.destination}</code>
                      {output.destinationField && (
                        <span className="text-xs text-muted-foreground ml-1">
                          .{output.destinationField}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="font-medium">{destInfo.table}</span>
                    </td>
                    <td className="p-3">
                      {status === "implemented" ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Done
                        </Badge>
                      ) : status === "partial" ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Partial
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Planned
                        </Badge>
                      )}
                      {note && (
                        <p className="text-[10px] text-muted-foreground mt-1 max-w-[200px]">
                          {note}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-2">
          <Database className="h-3 w-3" />
          Output resolution handled by:
          <code className="bg-muted px-1.5 py-0.5 rounded">
            src/lib/pipelines/output-resolver.ts
          </code>
        </p>
      </section>

      {/* Section 4: Implementation Files */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-gray-100 text-gray-700">
            <Code className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Implementation Files</h3>
            <p className="text-sm text-muted-foreground">
              Where the integration code lives
            </p>
          </div>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <span className="font-medium">Pipeline Package</span>
              <p className="text-xs text-muted-foreground">
                manifest, definition, registry, samplesheet
              </p>
            </div>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              pipelines/{pipelineId}/manifest.json
            </code>
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <span className="font-medium">Pipeline Adapter</span>
              <p className="text-xs text-muted-foreground">
                Custom code: validation, output discovery
              </p>
            </div>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              src/lib/pipelines/adapters/{pipelineId}.ts
            </code>
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <span className="font-medium">Output Resolver</span>
              <p className="text-xs text-muted-foreground">
                Maps discovered files to DB records
              </p>
            </div>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              src/lib/pipelines/output-resolver.ts
            </code>
          </div>
        </div>
      </section>
    </div>
  );
}
