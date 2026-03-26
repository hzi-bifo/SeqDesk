import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    submission: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sample: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  submitStudyToENA: vi.fn(),
  submitSamplesToENA: vi.fn(),
  generateStudyXml: vi.fn(),
  generateSampleXml: vi.fn(),
  generateSubmissionXml: vi.fn(),
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

vi.mock("@/lib/ena", () => ({
  submitStudyToENA: mocks.submitStudyToENA,
  submitSamplesToENA: mocks.submitSamplesToENA,
  generateStudyXml: mocks.generateStudyXml,
  generateSampleXml: mocks.generateSampleXml,
  generateSubmissionXml: mocks.generateSubmissionXml,
}));

import { GET, POST } from "./route";

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const researcherSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

describe("GET /api/admin/submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns enriched submissions with study entity details", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.submission.findMany.mockResolvedValue([
      {
        id: "sub-1",
        entityType: "study",
        entityId: "study-1",
        accessionNumbers: JSON.stringify({ study: "ERP123" }),
        createdAt: new Date(),
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Test Study",
      alias: "ts-1",
      studyAccessionId: "ERP123",
      user: { id: "u1", firstName: "Jane", lastName: "Doe", email: "j@e.com" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].entityDetails.title).toBe("Test Study");
    expect(body[0].accessionNumbers.study).toBe("ERP123");
  });

  it("returns enriched submissions with sample entity details", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.submission.findMany.mockResolvedValue([
      {
        id: "sub-2",
        entityType: "sample",
        entityId: "sample-1",
        accessionNumbers: null,
        createdAt: new Date(),
      },
    ]);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-1",
      sampleId: "S001",
      sampleTitle: "Sample One",
      sampleAccessionNumber: null,
      study: { id: "study-1", title: "Test Study" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].entityDetails.sampleId).toBe("S001");
    expect(body[0].accessionNumbers).toBeNull();
  });

  it("returns 500 when database throws", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.submission.findMany.mockRejectedValue(new Error("DB error"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to fetch submissions");
  });
});

describe("POST /api/admin/submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateStudyXml.mockReturnValue("<STUDY/>");
    mocks.generateSampleXml.mockReturnValue("<SAMPLE/>");
    mocks.generateSubmissionXml.mockReturnValue("<SUBMISSION/>");
  });

  it("returns 401 when user is not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 when user is RESEARCHER", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when entityType or entityId is missing", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("entityType and entityId are required");
  });

  it("returns 400 when ENA credentials are not configured", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("ENA credentials not configured");
  });

  it("returns 404 when study is not found", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "nonexistent" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Study not found");
  });

  it("returns 400 when study is already submitted to ENA", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "Study",
      description: "Desc",
      submitted: true,
      studyAccessionId: "ERP999",
      samples: [],
    });

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("already registered");
  });

  it("returns 400 when study has no samples", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "Study",
      description: "Desc",
      submitted: false,
      studyAccessionId: null,
      samples: [],
      studyMetadata: null,
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("at least one sample");
  });

  it("returns 400 for unsupported entity type", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "experiment", entityId: "e1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unsupported entity type");
  });

  it("returns 400 when samples are missing taxonomy IDs", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "Study",
      description: "A description",
      submitted: false,
      studyAccessionId: null,
      studyMetadata: null,
      samples: [
        { id: "sam-1", sampleId: "S001", taxId: "", sampleTitle: "S1", scientificName: null, customFields: null, checklistData: null, order: null },
      ],
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("missing taxonomy ID");
  });

  it("returns 400 when study title is empty", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "",
      description: "Desc",
      submitted: false,
      studyAccessionId: null,
      samples: [{ id: "sam-1", sampleId: "S001", taxId: "9606" }],
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Study title is required");
  });

  it("returns 400 when study description is empty", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "Title",
      description: "",
      submitted: false,
      studyAccessionId: null,
      samples: [{ id: "sam-1", sampleId: "S001", taxId: "9606" }],
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Study description is required");
  });

  it("returns 400 when a submission is already in progress", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "Study",
      description: "Desc",
      submitted: false,
      studyAccessionId: null,
      samples: [],
    });
    mocks.db.submission.findFirst.mockResolvedValue({
      id: "existing-sub",
      status: "PENDING",
    });

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("already in progress");
  });

  it("returns 500 when ENA study submission fails", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "My Study",
      description: "Study description",
      alias: "alias-1",
      submitted: false,
      studyAccessionId: null,
      studyMetadata: null,
      checklistType: null,
      samples: [
        {
          id: "sam-1",
          sampleId: "S001",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Homo sapiens",
          customFields: null,
          checklistData: null,
          order: null,
        },
      ],
      user: { id: "u1" },
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);
    mocks.submitStudyToENA.mockResolvedValue({
      success: false,
      error: "ENA rejected the study XML",
      receiptXml: "<ERROR/>",
    });
    mocks.db.submission.create.mockResolvedValue({ id: "sub-fail" });

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("ENA rejected the study XML");
    // Should create a failed submission record
    expect(mocks.db.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "ERROR",
      }),
    });
  });

  it("handles partial success when study succeeds but samples fail", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "My Study",
      description: "Study description",
      alias: "alias-1",
      submitted: false,
      studyAccessionId: null,
      studyMetadata: null,
      checklistType: null,
      samples: [
        {
          id: "sam-1",
          sampleId: "S001",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Homo sapiens",
          customFields: null,
          checklistData: null,
          order: null,
        },
      ],
      user: { id: "u1" },
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);
    mocks.submitStudyToENA.mockResolvedValue({
      success: true,
      accessions: { study: "ERP999" },
      receiptXml: "<RECEIPT/>",
    });
    mocks.submitSamplesToENA.mockResolvedValue({
      success: false,
      error: "Sample XML rejected",
      receiptXml: null,
    });
    mocks.db.submission.create.mockImplementation(async ({ data }) => ({
      id: "sub-partial",
      ...data,
    }));
    mocks.db.study.update.mockResolvedValue({});

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1", isTest: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submission).toBeDefined();
    // Should create a PARTIAL submission record
    expect(mocks.db.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PARTIAL",
      }),
    });
    // No samples updated since they failed
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("returns 500 when POST throws an unexpected error", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("DB down"));

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to create submission");
  });

  it("handles enrichment for unknown entity types in GET", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.submission.findMany.mockResolvedValue([
      {
        id: "sub-3",
        entityType: "experiment",
        entityId: "exp-1",
        accessionNumbers: null,
        createdAt: new Date(),
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].entityDetails).toBeNull();
  });

  it("merges study metadata, order customFields, and sample customFields for sample attributes", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "My Study",
      description: "Study description",
      alias: "alias-1",
      submitted: false,
      studyAccessionId: null,
      studyMetadata: JSON.stringify({ "environment (biome)": "soil" }),
      checklistType: "ERC000011",
      samples: [
        {
          id: "sam-1",
          sampleId: "S001",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Homo sapiens",
          customFields: JSON.stringify({ "sample_collection": "swab" }),
          checklistData: JSON.stringify({ "geographic location (country and/or sea)": "Germany" }),
          order: {
            id: "order-1",
            customFields: JSON.stringify({ "depth": "10m" }),
          },
        },
      ],
      user: { id: "u1" },
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);
    mocks.submitStudyToENA.mockResolvedValue({
      success: true,
      accessions: { study: "ERP123" },
      receiptXml: "<RECEIPT/>",
    });
    mocks.submitSamplesToENA.mockResolvedValue({
      success: true,
      accessions: { samples: { S001: "ERS001" } },
      receiptXml: "<RECEIPT/>",
    });
    mocks.db.submission.create.mockImplementation(async ({ data }) => ({
      id: "sub-new",
      ...data,
    }));
    mocks.db.study.update.mockResolvedValue({});
    mocks.db.sample.update.mockResolvedValue({});

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    // Check that sample XML was generated with merged attributes
    expect(mocks.generateSampleXml).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "S001",
          checklistType: "ERC000011",
          attributes: expect.objectContaining({
            "environment (biome)": "soil",
            depth: "10m",
            sample_collection: "swab",
            "geographic location (country and/or sea)": "Germany",
          }),
        }),
      ])
    );
  });

  it("submits study and samples to ENA successfully", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "user",
      enaPassword: "pass",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "s1",
      title: "My Study",
      description: "Study description",
      alias: "alias-1",
      submitted: false,
      studyAccessionId: null,
      studyMetadata: null,
      checklistType: null,
      samples: [
        {
          id: "sam-1",
          sampleId: "S001",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Homo sapiens",
          customFields: null,
          checklistData: null,
          order: null,
        },
      ],
      user: { id: "u1" },
    });
    mocks.db.submission.findFirst.mockResolvedValue(null);
    mocks.submitStudyToENA.mockResolvedValue({
      success: true,
      accessions: { study: "ERP123456" },
      receiptXml: "<RECEIPT/>",
    });
    mocks.submitSamplesToENA.mockResolvedValue({
      success: true,
      accessions: { samples: { S001: "ERS999" } },
      receiptXml: "<RECEIPT/>",
    });
    mocks.db.submission.create.mockImplementation(async ({ data }) => ({
      id: "sub-new",
      ...data,
    }));
    mocks.db.study.update.mockResolvedValue({});
    mocks.db.sample.update.mockResolvedValue({});

    const request = new Request("http://localhost/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: "s1", isTest: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submission).toBeDefined();
    expect(body.message).toContain("Test Server");
    expect(mocks.submitStudyToENA).toHaveBeenCalledTimes(1);
    expect(mocks.submitSamplesToENA).toHaveBeenCalledTimes(1);
    expect(mocks.db.sample.update).toHaveBeenCalledTimes(1);
  });
});
