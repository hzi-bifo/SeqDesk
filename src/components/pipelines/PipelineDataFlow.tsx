"use client";

import {
  ArrowRight,
  Database,
  FileInput,
  FileOutput,
  FlaskConical,
  FolderInput,
  HardDrive,
  Layers,
} from "lucide-react";

interface PipelineInput {
  id: string;
  name: string;
  description: string;
  fileTypes: string[];
  source: string;
  sourceDescription: string;
}

interface PipelineOutput {
  id: string;
  name: string;
  description: string;
  fromStep: string;
  fileTypes: string[];
  destination: string;
  destinationField?: string;
  destinationDescription: string;
}

interface PipelineDataFlowProps {
  pipelineName: string;
  inputs: PipelineInput[];
  outputs: PipelineOutput[];
  compact?: boolean;
}

function getSourceIcon(source: string) {
  switch (source) {
    case "order_reads":
      return <FolderInput className="h-4 w-4" />;
    case "samplesheet":
      return <FileInput className="h-4 w-4" />;
    default:
      return <Database className="h-4 w-4" />;
  }
}

function getSourceLabel(source: string) {
  switch (source) {
    case "order_reads":
      return "Order Files";
    case "samplesheet":
      return "Auto-generated";
    default:
      return source;
  }
}

function getDestinationIcon(destination: string) {
  switch (destination) {
    case "sample_assemblies":
      return <Layers className="h-4 w-4" />;
    case "sample_bins":
      return <HardDrive className="h-4 w-4" />;
    case "sample_qc":
    case "sample_metadata":
      return <Database className="h-4 w-4" />;
    case "sample_annotations":
      return <FileOutput className="h-4 w-4" />;
    case "order_report":
      return <FileOutput className="h-4 w-4" />;
    default:
      return <Database className="h-4 w-4" />;
  }
}

function getDestinationLabel(destination: string) {
  switch (destination) {
    case "sample_assemblies":
      return "Sample Assemblies";
    case "sample_bins":
      return "Sample Bins";
    case "sample_qc":
      return "Sample QC";
    case "sample_metadata":
      return "Sample Metadata";
    case "sample_annotations":
      return "Sample Annotations";
    case "order_report":
      return "Study Report";
    default:
      return destination;
  }
}

export function PipelineDataFlow({
  pipelineName,
  inputs,
  outputs,
  compact = false,
}: PipelineDataFlowProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 text-sm">
        {/* Inputs */}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            {inputs.slice(0, 2).map((input) => (
              <div
                key={input.id}
                className="h-6 w-6 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center"
                title={input.name}
              >
                {getSourceIcon(input.source)}
              </div>
            ))}
          </div>
          <span className="text-muted-foreground">
            {inputs.length} input{inputs.length !== 1 ? "s" : ""}
          </span>
        </div>

        <ArrowRight className="h-4 w-4 text-muted-foreground" />

        {/* Pipeline */}
        <div className="px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
          <FlaskConical className="h-4 w-4 inline mr-1" />
          Pipeline
        </div>

        <ArrowRight className="h-4 w-4 text-muted-foreground" />

        {/* Outputs */}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            {outputs.slice(0, 3).map((output) => (
              <div
                key={output.id}
                className="h-6 w-6 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center"
                title={output.name}
              >
                {getDestinationIcon(output.destination)}
              </div>
            ))}
          </div>
          <span className="text-muted-foreground">
            {outputs.length} output{outputs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h3 className="font-semibold mb-1">Data Integration</h3>
        <p className="text-sm text-muted-foreground">
          How {pipelineName} connects with your SeqDesk data
        </p>
      </div>

      {/* Flow Diagram */}
      <div className="flex items-stretch gap-4">
        {/* Inputs Column */}
        <div className="flex-1 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            Inputs from SeqDesk
          </div>
          {inputs.map((input) => (
            <div
              key={input.id}
              className="p-3 rounded-lg border bg-blue-50/50 border-blue-200"
            >
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded bg-blue-100 text-blue-700">
                  {getSourceIcon(input.source)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{input.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {input.sourceDescription}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {input.fileTypes.map((ft) => (
                      <span
                        key={ft}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono"
                      >
                        .{ft}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Arrow */}
        <div className="flex flex-col items-center justify-center px-2">
          <div className="flex-1 w-px bg-gradient-to-b from-blue-300 via-primary to-emerald-300" />
          <div className="my-4 p-3 rounded-xl bg-primary text-primary-foreground shadow-lg">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div className="flex-1 w-px bg-gradient-to-b from-primary via-emerald-300 to-emerald-300" />
        </div>

        {/* Outputs Column */}
        <div className="flex-1 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            Outputs to SeqDesk
          </div>
          {outputs.map((output) => (
            <div
              key={output.id}
              className="p-3 rounded-lg border bg-emerald-50/50 border-emerald-200"
            >
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded bg-emerald-100 text-emerald-700">
                  {getDestinationIcon(output.destination)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{output.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {output.destinationDescription}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {output.fileTypes.slice(0, 3).map((ft) => (
                      <span
                        key={ft}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono"
                      >
                        .{ft}
                      </span>
                    ))}
                    {output.fileTypes.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        +{output.fileTypes.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 pt-2 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span>Data pulled from SeqDesk</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>Results stored in SeqDesk</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact summary of data flow for pipeline cards
 */
export function PipelineDataFlowSummary({
  inputs,
  outputs,
}: {
  inputs: PipelineInput[];
  outputs: PipelineOutput[];
}) {
  // Group outputs by destination type
  const outputGroups = outputs.reduce(
    (acc, output) => {
      const key = output.destination;
      if (!acc[key]) acc[key] = [];
      acc[key].push(output);
      return acc;
    },
    {} as Record<string, PipelineOutput[]>
  );

  return (
    <div className="space-y-3">
      {/* Inputs */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <ArrowRight className="h-3 w-3 rotate-180" />
          Takes from SeqDesk:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {inputs.map((input) => (
            <span
              key={input.id}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
            >
              {getSourceIcon(input.source)}
              {input.name}
            </span>
          ))}
        </div>
      </div>

      {/* Outputs */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <ArrowRight className="h-3 w-3" />
          Saves to SeqDesk:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(outputGroups).map(([dest, items]) => (
            <span
              key={dest}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              {getDestinationIcon(dest)}
              {getDestinationLabel(dest)}
              {items.length > 1 && (
                <span className="text-emerald-500">({items.length})</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
