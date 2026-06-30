import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  buildStudyTableData: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/studies/study-table", () => ({
  buildStudyTableData: mocks.buildStudyTableData,
}));

import { GET } from "./route";

const params = Promise.resolve({ id: "study-1" });
const req = () =>
  new Request("http://localhost/api/studies/study-1/table/export");

function adminSession() {
  return { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
}
function researcherSession(id = "user-1") {
  return { user: { id, role: "RESEARCHER" } };
}

// A small but faithful StudyTableData model: the export route reads
// data.study.{userId,alias,title}, data.columns[{key,label,kind,editable}],
// data.rows[{id,cells}], and data.info[{heading,subheading,fields}].
function fakeTableData(overrides: Record<string, unknown> = {}) {
  return {
    study: {
      id: "study-1",
      title: "Study One",
      alias: null,
      userId: "user-1",
      checklistType: "soil",
      sampleCount: 1,
    },
    columns: [
      { key: "_sampleId", label: "Sample ID", kind: "identity", group: "identity" },
      { key: "_status", label: "Status", kind: "status", group: "status" },
      {
        key: "checklist:collection_date",
        label: "Collection Date",
        kind: "field",
        group: "mixs",
        editable: true,
      },
    ],
    rows: [
      {
        id: "s1",
        status: "SEQUENCED",
        statusLabel: "Sequenced",
        cells: {
          _sampleId: "S-1",
          _status: "Sequenced",
          "checklist:collection_date": "2024-01-01",
        },
      },
    ],
    info: [
      {
        heading: "Study",
        fields: [{ label: "MIxS checklist", value: "soil" }],
      },
    ],
    availableMixsFields: [],
    perStudy: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue(adminSession());
  mocks.buildStudyTableData.mockResolvedValue(fakeTableData());
});

describe("GET /api/studies/[id]/table/export", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the study cannot be resolved", async () => {
    mocks.buildStudyTableData.mockResolvedValueOnce(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin accessing someone else's study", async () => {
    mocks.getServerSession.mockResolvedValueOnce(researcherSession("other-user"));
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
  });

  it("streams an XLSX workbook for a facility admin", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("filename=");
    expect(disposition).toContain(".xlsx");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("streams an XLSX workbook for the owning researcher", async () => {
    mocks.getServerSession.mockResolvedValueOnce(researcherSession("user-1"));
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("derives the download filename from the study alias when present", async () => {
    mocks.buildStudyTableData.mockResolvedValueOnce(
      fakeTableData({
        study: {
          id: "study-1",
          title: "Study One",
          alias: "My Cool Study!!",
          userId: "user-1",
          checklistType: "soil",
          sampleCount: 1,
        },
      })
    );
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    // unsafe characters collapse to "_"; trailing "_" is trimmed.
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="My_Cool_Study-table.xlsx"'
    );
  });

  it("documents formula-injection handling: a cell value that looks like a formula is written as a literal string, not a live formula", async () => {
    // Two classic CSV/XLSX injection payloads: an "=" formula and an "@" form.
    const formulaData = fakeTableData({
      rows: [
        {
          id: "s1",
          status: "SEQUENCED",
          statusLabel: "Sequenced",
          cells: {
            _sampleId: "=1+1",
            _status: "Sequenced",
            "checklist:collection_date": "@SUM(A1)",
          },
        },
      ],
    });
    mocks.buildStudyTableData.mockResolvedValueOnce(formulaData);

    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);

    // Re-open the produced workbook with the real ExcelJS to confirm what the
    // route actually wrote. ExcelJS stores a plain object {key: value} row as a
    // STRING cell (cell.type === ValueType.String); it does NOT promote a string
    // beginning with "=" into a live formula (that requires { formula: ... }).
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body);
    const sheet = wb.getWorksheet("Study Samples")!;
    expect(sheet).toBeDefined();

    // Row 1 is the header; the single data row is row 2. Columns are:
    // 1 = hidden _seqdeskRowId, 2 = Sample ID, then the table columns.
    const dataRow = sheet.getRow(2);
    const sampleIdCell = dataRow.getCell(2); // "Sample ID" column
    const collectionDateCell = dataRow.getCell(4); // "Collection Date" column

    // The value round-trips verbatim...
    expect(sampleIdCell.value).toBe("=1+1");
    expect(collectionDateCell.value).toBe("@SUM(A1)");
    // ...and it is a String cell, NOT a Formula cell.
    expect(sampleIdCell.type).toBe(ExcelJS.ValueType.String);
    expect(sampleIdCell.formula).toBeUndefined();
    expect(collectionDateCell.type).toBe(ExcelJS.ValueType.String);
    expect(collectionDateCell.formula).toBeUndefined();
  });
});
