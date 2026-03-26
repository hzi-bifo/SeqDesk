import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  resolveDataBasePathFromStoredValue: vi.fn(),
  ensureWithinBase: vi.fn(),
  resolveTemplateSource: vi.fn(),
  selectTemplatePair: vi.fn(),
  buildSimulatedFastq: vi.fn(),
  fsPromises: {
    stat: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    constants: { W_OK: 2 },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue: mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("@/lib/files", () => ({
  ensureWithinBase: mocks.ensureWithinBase,
}));

vi.mock("@/lib/simulation/fastq", () => ({
  buildSimulatedFastq: mocks.buildSimulatedFastq,
}));

vi.mock("@/lib/simulation/template-source", () => ({
  resolveTemplateSource: mocks.resolveTemplateSource,
  selectTemplatePair: mocks.selectTemplatePair,
}));

vi.mock("fs/promises", () => ({
  ...mocks.fsPromises,
  default: mocks.fsPromises,
}));

vi.mock("zlib", () => ({
  gzipSync: (buf: Buffer) => buf,
}));

import { POST } from "./route";

describe("POST /api/admin/settings/sequencing-files/simulate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/sequencing",
      extraSettings: null,
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/data/sequencing",
      source: "database",
      isImplicit: false,
    });
    mocks.fsPromises.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.fsPromises.access.mockResolvedValue(undefined);
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
    mocks.ensureWithinBase.mockReturnValue("/data/sequencing/seqdesk-test-folder");
    mocks.resolveTemplateSource.mockResolvedValue({
      modeRequested: "auto",
      modeUsed: "synthetic",
      templateDir: null,
      templatePairs: [],
    });
    mocks.buildSimulatedFastq.mockReturnValue({
      read1: Buffer.from("@read1\nACGT\n+\nIIII\n"),
      read2: Buffer.from("@read2\nTGCA\n+\nIIII\n"),
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when data base path is not configured", async () => {
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: null,
      source: "none",
      isImplicit: true,
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("not configured");
  });

  it("returns 400 when data base path is not a directory", async () => {
    mocks.fsPromises.stat.mockResolvedValue({ isDirectory: () => false });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("not a directory");
  });

  it("creates simulated files on happy path", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2, readCount: 500, readLength: 100 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.samples).toHaveLength(2);
    expect(json.simulationMode).toBe("synthetic");
    expect(json.extension).toBe(".fastq.gz");
    // With 2 samples: sample 1 is paired, sample 2 is single-end (last sample + allowSingleEnd)
    expect(json.pairedCount).toBe(1);
    expect(json.singleEndCount).toBe(1);
    expect(json.filesCreated).toBe(3); // 2 for paired + 1 for single-end
  });
});
