import { NextResponse } from "next/server";
import {
  requireFacilityAdminSequencingReadSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import { listSequencingRunsForOrder } from "@/lib/sequencing/run-plan";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    await requireFacilityAdminSequencingReadSession();
    const { id, runId } = await params;
    const ExcelJS = await import("exceljs");
    const { fields, runs } = await listSequencingRunsForOrder(id, {
      isFacilityAdmin: true,
    });
    const run = runs.find((item) => item.id === runId);
    if (!run) {
      return NextResponse.json({ error: "Sequencing run not found" }, { status: 404 });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SeqDesk";
    workbook.created = new Date();

    const runSheet = workbook.addWorksheet("Run Metadata");
    runSheet.columns = [
      { header: "Field", key: "field", width: 24 },
      { header: "Value", key: "value", width: 40 },
    ];
    runSheet.addRows([
      { field: "Run ID", value: run.runId },
      { field: "Run Name", value: run.runName ?? "" },
      { field: "Run Date", value: run.runDate ? run.runDate.slice(0, 10) : "" },
      { field: "Platform", value: run.platform ?? "" },
      { field: "Instrument", value: run.instrument ?? "" },
      { field: "Folder Path", value: run.folderPath ?? "" },
      ...Object.entries(run.runParameters).map(([field, value]) => ({
        field,
        value: String(value ?? ""),
      })),
    ]);
    runSheet.getRow(1).font = { bold: true };

    const sampleSheet = workbook.addWorksheet("Run Samples");
    const columns = [
      { header: "Run", key: "runId", width: 18 },
      { header: "Barcode", key: "barcode", width: 14 },
      { header: "Sample ID", key: "sampleCode", width: 24 },
      { header: "Material", key: "material", width: 20 },
      ...fields
        .filter((field) => field.name !== "barcode")
        .map((field) => ({ header: field.label, key: field.name, width: 22 })),
    ];
    sampleSheet.columns = columns;
    sampleSheet.getRow(1).font = { bold: true };
    sampleSheet.addRows(
      run.samples.map((sample) => ({
        runId: run.runId,
        barcode: sample.barcode ?? "",
        sampleCode: sample.sampleCode,
        material: sample.material ?? "",
        ...sample.customFields,
      }))
    );
    sampleSheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${run.runId}-run-plan.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Sequencing Run Export] error:", error);
    return NextResponse.json({ error: "Failed to export run plan" }, { status: 500 });
  }
}
