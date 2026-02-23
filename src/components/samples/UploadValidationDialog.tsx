"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { ParseResult, ValidationError } from "@/lib/excel/sample-parser";

interface UploadValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ParseResult | null;
  onImport: (mode: "all" | "valid-only", replaceOrAppend: "replace" | "append") => void;
}

export function UploadValidationDialog({
  open,
  onOpenChange,
  result,
  onImport,
}: UploadValidationDialogProps) {
  if (!result) return null;

  const { samples, errors, warnings, unmappedColumns, totalRows } = result;
  const errorRows = new Set(errors.filter((e) => e.severity === "error").map((e) => e.row));
  const validCount = totalRows - errorRows.size;
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Excel Data</DialogTitle>
          <DialogDescription>
            Parsed {totalRows} row{totalRows !== 1 ? "s" : ""} from the uploaded file.
            {hasErrors && (
              <span className="text-destructive">
                {" "}
                {errorRows.size} row{errorRows.size !== 1 ? "s" : ""} have validation errors.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
          {/* Unmapped columns info */}
          {unmappedColumns.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-muted rounded-md text-sm">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">Unrecognized columns (skipped):</p>
                <p className="text-muted-foreground">
                  {unmappedColumns.join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="space-y-1">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Warnings
              </p>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Row</th>
                      <th className="px-3 py-1.5 text-left font-medium">Field</th>
                      <th className="px-3 py-1.5 text-left font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warnings.map((w, i) => (
                      <tr key={`w-${i}`} className="border-t">
                        <td className="px-3 py-1.5 text-amber-600">
                          {w.row || "All"}
                        </td>
                        <td className="px-3 py-1.5">{w.field}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {w.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Errors */}
          {hasErrors && (
            <div className="space-y-1">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Validation Errors ({errors.length})
              </p>
              <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium w-14">Row</th>
                      <th className="px-3 py-1.5 text-left font-medium">Field</th>
                      <th className="px-3 py-1.5 text-left font-medium">Value</th>
                      <th className="px-3 py-1.5 text-left font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.slice(0, 100).map((e, i) => (
                      <tr key={`e-${i}`} className="border-t">
                        <td className="px-3 py-1.5 text-destructive">{e.row}</td>
                        <td className="px-3 py-1.5">{e.field}</td>
                        <td className="px-3 py-1.5 font-mono text-xs max-w-[120px] truncate">
                          {e.value || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {e.message}
                        </td>
                      </tr>
                    ))}
                    {errors.length > 100 && (
                      <tr className="border-t">
                        <td
                          colSpan={4}
                          className="px-3 py-1.5 text-center text-muted-foreground"
                        >
                          ... and {errors.length - 100} more errors
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Success state */}
          {!hasErrors && !hasWarnings && totalRows > 0 && (
            <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-md text-sm text-green-700 dark:text-green-400">
              All {totalRows} rows are valid and ready to import.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {hasErrors && validCount > 0 && (
            <Button
              variant="outline"
              onClick={() => onImport("valid-only", "replace")}
            >
              Import Valid Only ({validCount})
            </Button>
          )}
          {totalRows > 0 && (
            <Button
              onClick={() => onImport("all", "replace")}
              variant={hasErrors ? "outline" : "default"}
            >
              Import {hasErrors ? "All" : ""} ({totalRows} row{totalRows !== 1 ? "s" : ""})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
