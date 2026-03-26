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

  it("handles malformed extraSettings JSON gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/sequencing",
      extraSettings: "not-valid-json{{{",
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    // Falls back to defaults
    expect(json.extension).toBe(".fastq.gz");
  });

  it("caps readCount at MAX_READ_COUNT (50000)", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1, readCount: 999999, readLength: 100 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.readCount).toBe(50000);
  });

  it("caps readLength at MAX_READ_LENGTH (300)", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1, readCount: 100, readLength: 999 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.readLength).toBe(300);
  });

  it("uses .fastq extension without gzip when configured", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/sequencing",
      extraSettings: JSON.stringify({
        sequencingFiles: {
          allowedExtensions: [".fastq"],
        },
      }),
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.extension).toBe(".fastq");
    // writeFile should be called (no gzip for non-.gz)
    expect(mocks.fsPromises.writeFile).toHaveBeenCalled();
  });

  it("creates multiple samples correctly", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 5, readCount: 100, readLength: 50 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.samples).toHaveLength(5);
    // Samples 1-4 paired, sample 5 single-end
    expect(json.pairedCount).toBe(4);
    expect(json.singleEndCount).toBe(1);
    expect(json.filesCreated).toBe(9); // 4*2 + 1
  });

  it("returns 500 when an unexpected error occurs", async () => {
    mocks.resolveTemplateSource.mockRejectedValue(new Error("Unexpected failure"));

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toContain("Failed to create test files");
  });

  it("returns 400 when data base path is not writable", async () => {
    mocks.fsPromises.access.mockRejectedValue(new Error("EACCES"));

    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("not writable");
  });

  it("handles request body parse failure gracefully", async () => {
    // NextRequest with invalid body - use no body at all
    const request = new NextRequest("http://localhost:3000/api/admin/settings/sequencing-files/simulate", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    // Defaults should be used
    expect(json.samples).toHaveLength(3);
  });
});
