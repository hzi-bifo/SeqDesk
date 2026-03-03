import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ena api-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits study and extracts accession on success", async () => {
    const study: StudyData = {
      alias: "PRJTEST",
      title: "Test study",
      description: "desc",
    };

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
    const study: StudyData = {
      alias: "PRJTEST",
      title: "Test study",
      description: "desc",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", {
        status: 401,
      })
    );

    const result = await submitStudyToENA(credentials, study);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
  });

  it("submits samples and maps sample + biosample accessions", async () => {
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

  it("stops sample submission when study submission fails", async () => {
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
    ];

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
