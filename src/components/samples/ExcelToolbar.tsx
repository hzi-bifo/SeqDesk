"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import type { FormFieldDefinition } from "@/types/form-config";
import type { BarcodeOptionsArg } from "@/lib/excel/field-mapping";
import type { ParseResult, ParsedSample } from "@/lib/excel/sample-parser";
import { UploadValidationDialog } from "./UploadValidationDialog";

interface SampleRow {
  id: string;
  sampleId: string;
  [key: string]: unknown;
}

export interface ExcelToolbarProps {
  perSampleFields: FormFieldDefinition[];
  samples: SampleRow[];
  barcodeOptions?: BarcodeOptionsArg | null;
  onSamplesImported: (samples: SampleRow[], mode: "replace" | "append") => void;
  disabled?: boolean;
  entityName?: string;
}

export function ExcelToolbar({
  perSampleFields,
  samples,
  barcodeOptions,
  onSamplesImported,
  disabled,
  entityName,
}: ExcelToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDownload = useCallback(async () => {
    if (perSampleFields.length === 0) return;
    setDownloading(true);
    try {
      const { generateSampleTemplate } = await import(
        "@/lib/excel/sample-template"
      );
      const blob = await generateSampleTemplate(
        perSampleFields,
        samples,
        barcodeOptions,
        entityName
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sample_template${entityName ? `_${entityName}` : ""}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate template:", err);
    } finally {
      setDownloading(false);
    }
  }, [perSampleFields, samples, barcodeOptions, entityName]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input so the same file can be re-selected
      e.target.value = "";

      setUploading(true);
      try {
        const { parseSampleExcel } = await import(
          "@/lib/excel/sample-parser"
        );
        const result = await parseSampleExcel(
          file,
          perSampleFields,
          barcodeOptions
        );
        setParseResult(result);
        setDialogOpen(true);
      } catch (err) {
        console.error("Failed to parse Excel file:", err);
        setParseResult({
          samples: [],
          errors: [
            {
              row: 0,
              field: "",
              value: "",
              message: `Failed to read file: ${err instanceof Error ? err.message : "Unknown error"}. Make sure it is a valid .xlsx file.`,
              severity: "error",
            },
          ],
          warnings: [],
          unmappedColumns: [],
          totalRows: 0,
        });
        setDialogOpen(true);
      } finally {
        setUploading(false);
      }
    },
    [perSampleFields, barcodeOptions]
  );

  const handleImport = useCallback(
    (mode: "all" | "valid-only", replaceOrAppend: "replace" | "append") => {
      if (!parseResult) return;

      let samplesToImport: ParsedSample[];
      if (mode === "valid-only") {
        const errorRows = new Set(
          parseResult.errors
            .filter((e) => e.severity === "error")
            .map((e) => e.row)
        );
        samplesToImport = parseResult.samples.filter(
          (_, i) => !errorRows.has(i + 1)
        );
      } else {
        samplesToImport = parseResult.samples;
      }

      onSamplesImported(samplesToImport as SampleRow[], replaceOrAppend);
      setDialogOpen(false);
      setParseResult(null);
    },
    [parseResult, onSamplesImported]
  );

  if (perSampleFields.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={disabled || downloading}
      >
        <Download className="h-4 w-4 mr-1" />
        {downloading ? "Generating..." : "Excel Template"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleUploadClick}
        disabled={disabled || uploading}
      >
        <Upload className="h-4 w-4 mr-1" />
        {uploading ? "Reading..." : "Upload Excel"}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />
      <UploadValidationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        result={parseResult}
        onImport={handleImport}
      />
    </>
  );
}
