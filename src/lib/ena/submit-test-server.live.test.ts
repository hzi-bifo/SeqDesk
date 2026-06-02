import { describe, expect, it } from "vitest";
import { submitSamplesToENA, submitStudyToENA } from "./api-client";

/**
 * Real end-to-end submission against the ENA TEST server (wwwdev.ebi.ac.uk).
 *
 * ENA test submissions are non-permanent — the test server expires them (no
 * public records are created) — and `testMode: true` guarantees the request
 * never reaches production. This proves SeqDesk can actually register a study
 * AND a sample with ENA and receive real accessions, rather than only
 * exercising mocked HTTP.
 *
 * A Webin TEST account is required and is read from the environment, so the
 * test self-skips wherever credentials are not configured (local dev, PRs):
 *
 *   WEBIN_TEST_USERNAME=Webin-XXXXX
 *   WEBIN_TEST_PASSWORD=...
 *
 * Runs in the `live` tier only (see vitest.config.ts), so it never affects the
 * fast unit-test suite. Credentials are never hard-coded — they come from the
 * environment (CI: GitHub Actions secrets).
 */
const username = process.env.WEBIN_TEST_USERNAME?.trim();
const password = process.env.WEBIN_TEST_PASSWORD?.trim();
const hasCredentials = Boolean(username && password);

describe("ENA test-server submission (live)", () => {
  if (!hasCredentials) {
    it.skip("submits to the ENA test server (set WEBIN_TEST_USERNAME / WEBIN_TEST_PASSWORD to run)", () => {});
    return;
  }

  const credentials = {
    username: username as string,
    password: password as string,
    testMode: true,
  };

  it(
    "registers a study and returns a real accession",
    async () => {
      const result = await submitStudyToENA(credentials, {
        alias: `seqdesk-ci-study-${Date.now()}`,
        title: "SeqDesk CI test study",
        description:
          "Automated end-to-end submission to the ENA test server from SeqDesk CI. Temporary test record; expires per ENA test-server policy.",
      });

      // A real accession (PRJ…) confirms ENA accepted and registered the study.
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.accessions?.study).toMatch(/^PRJ/);
    },
    60_000,
  );

  it(
    "registers a sample and returns a real accession",
    async () => {
      const alias = `seqdesk-ci-sample-${Date.now()}`;
      const result = await submitSamplesToENA(credentials, [
        {
          alias,
          title: "SeqDesk CI test sample",
          taxId: "562", // Escherichia coli — a valid NCBI TAXON_ID
          scientificName: "Escherichia coli",
        },
      ]);

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.accessions?.samples?.[alias]).toBeTruthy();
    },
    60_000,
  );
});
