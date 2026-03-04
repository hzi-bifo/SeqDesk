import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getENAUrl,
  submitStudyToENA,
  submitSamplesToENA,
  submitStudyAndSamplesToENA,
} from "./api-client";
import type { ENACredentials, StudyData, SampleData } from "./types";

const credentials: ENACredentials = {
  username: "user",
  password: "secret",
  testMode: true,
};

const study: StudyData = {
  alias: "PRJTEST",
  title: "Test study",
  description: "desc",
};

const samples: SampleData[] = [
  {
    alias: "S1",
    title: "Sample 1",
    taxId: "9606",
  },
  {
    alias: "S2",
    title: "Sample 2",
    taxId: "9606",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ena api-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("selects ENA URL by mode", () => {
    expect(getENAUrl(true)).toBe("https://wwwdev.ebi.ac.uk/ena/submit/drop-box/submit/");
    expect(getENAUrl(false)).toBe("https://www.ebi.ac.uk/ena/submit/drop-box/submit/");
  });

  it("submits study and extracts accession on success", async () => {

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><RECEIPT success="true"><PROJECT alias="PRJTEST" accession="PRJ000111" /></RECEIPT>',
        { status: 200 }
      )
    );

    const result = await submitStudyToENA(credentials, study);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.accessions).toEqual({ study: "PRJ000111" });
    expect(result.receiptXml).toContain("PRJ000111");
  });

  it("maps 401 ENA response to authentication error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", {
        status: 401,
      })
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
  });

  it("uses production URL and basic auth header when test mode is disabled", async () => {
    const prodCredentials: ENACredentials = {
      ...credentials,
      testMode: false,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<RECEIPT success="true"><PROJECT alias="PRJTEST" accession="PRJ000222" /></RECEIPT>',
        { status: 200 }
      )
    );

    const result = await submitStudyToENA(prodCredentials, study);

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://www.ebi.ac.uk/ena/submit/drop-box/submit/");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Basic dXNlcjpzZWNyZXQ=",
    });
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("falls back to default ENA error when receipt has no explicit errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('<RECEIPT success="false"></RECEIPT>', {
        status: 500,
      })
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toBe("ENA submission failed");
  });

  it("returns receipt errors for non-auth study failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<RECEIPT success="false"><ERROR>Validation failed</ERROR></RECEIPT>',
        { status: 500 }
      )
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Validation failed");
  });

  it("returns success with empty study accessions when receipt has no PROJECT entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('<RECEIPT success="true"></RECEIPT>', {
        status: 200,
      })
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(true);
    expect(result.accessions).toEqual({});
  });

  it("uses first project accession when no alias matches the study alias", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<RECEIPT success="true"><PROJECT alias="DIFFERENT" accession="PRJ000333" /><PROJECT alias="OTHER" accession="PRJ000444" /></RECEIPT>',
        { status: 200 }
      )
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(true);
    expect(result.accessions).toEqual({ study: "PRJ000333" });
  });

  it("handles thrown study submission errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("falls back to unknown message for non-Error study failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("socket closed");

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error occurred");
  });

  it("submits samples and maps sample + biosample accessions", async () => {

    const responseXml = [
      '<RECEIPT success="true">',
      '  <SAMPLE alias="S1" accession="ERS0001">',
      '    <EXT_ID accession="SAMEA111"/>',
      '  </SAMPLE>',
      '  <SAMPLE alias="S2" accession="ERS0002">',
      '    <EXT_ID accession="SAMEA222"/>',
      '  </SAMPLE>',
      "</RECEIPT>",
    ].join("");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseXml, {
        status: 200,
      })
    );

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(true);
    expect(result.accessions).toEqual({
      samples: {
        S1: "ERS0001",
        S2: "ERS0002",
      },
      biosamples: {
        S1: "SAMEA111",
        S2: "SAMEA222",
      },
    });
  });

  it("maps 401 sample submission responses to authentication error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", {
        status: 401,
      })
    );

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
  });

  it("returns receipt errors for non-auth sample failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<RECEIPT success="false"><ERROR>Sample failure</ERROR></RECEIPT>',
        { status: 500 }
      )
    );

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sample failure");
  });

  it("falls back to default sample error when receipt has no explicit errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('<RECEIPT success="false"></RECEIPT>', {
        status: 500,
      })
    );

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(false);
    expect(result.error).toBe("ENA submission failed");
  });

  it("keeps biosample map empty when biosample IDs are absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<RECEIPT success="true"><SAMPLE alias="S1" accession="ERS0001" /><SAMPLE alias="S2" accession="ERS0002" /></RECEIPT>',
        { status: 200 }
      )
    );

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(true);
    expect(result.accessions).toEqual({
      samples: {
        S1: "ERS0001",
        S2: "ERS0002",
      },
      biosamples: {},
    });
  });

  it("handles thrown sample submission errors with unknown fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("socket closed");

    const result = await submitSamplesToENA(credentials, samples);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error occurred");
  });

  it("submits samples after a successful study submission", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          '<RECEIPT success="true"><PROJECT alias="PRJTEST" accession="PRJ000111" /></RECEIPT>',
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          '<RECEIPT success="true"><SAMPLE alias="S1" accession="ERS1001" /></RECEIPT>',
          { status: 200 }
        )
      );

    const result = await submitStudyAndSamplesToENA(credentials, study, samples);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.studyResult.success).toBe(true);
    expect(result.samplesResult?.success).toBe(true);
    expect(result.samplesResult?.accessions).toEqual({
      samples: { S1: "ERS1001" },
      biosamples: {},
    });
  });

  it("stops sample submission when study submission fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("failure", {
        status: 500,
      })
    );

    const result = await submitStudyAndSamplesToENA(credentials, study, samples);

    expect(result.studyResult.success).toBe(false);
    expect(result.samplesResult).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
