import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildStudyTableData } from "@/lib/studies/study-table";

// GET an XLSX export of the study "Table overview": one row per sample, the same
// identity + status + per-sample metadata columns as the on-screen table, plus a
// "Study Metadata" sheet for the study-level fields.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const data = await buildStudyTableData(id, { isFacilityAdmin });

    if (!data) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    if (!isFacilityAdmin && data.study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SeqDesk";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Study Samples");
    sheet.columns = [
      { header: "SeqDesk Row ID", key: "_seqdeskRowId", width: 18 },
      ...data.columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: column.kind === "field" ? 24 : 18,
      })),
    ];
    sheet.getColumn(1).hidden = true;
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.addRows(
      data.rows.map((row) => ({
        _seqdeskRowId: row.id,
        ...row.cells,
      }))
    );

    data.columns.forEach((column, index) => {
      if (!column.editable) return;
      const worksheetColumn = sheet.getColumn(index + 2);
      worksheetColumn.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
        if (rowNumber === 1) return;
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      });
    });

    if (data.info.length > 0) {
      const metaSheet = workbook.addWorksheet("Study Info");
      metaSheet.columns = [
        { header: "Section", key: "section", width: 22 },
        { header: "Field", key: "field", width: 30 },
        { header: "Value", key: "value", width: 56 },
      ];
      metaSheet.getRow(1).font = { bold: true };
      metaSheet.addRow({ section: "Study", field: "Title", value: data.study.title });
      for (const panel of data.info) {
        const section = panel.subheading
          ? `${panel.heading} — ${panel.subheading}`
          : panel.heading;
        for (const field of panel.fields) {
          metaSheet.addRow({ section, field: field.label, value: field.value });
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const safeName =
      (data.study.alias || data.study.title || "study")
        .replace(/[^a-z0-9._-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "study";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}-table.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[Study Table Export] error:", error);
    return NextResponse.json(
      { error: "Failed to export study table" },
      { status: 500 }
    );
  }
}
