import { describe, expect, it } from "vitest";
import { submitStudyToENA } from "./api-client";

/**
 * Real end-to-end submission against the ENA TEST server (wwwdev.ebi.ac.uk).
 *
 * ENA test submissions are non-permanent — the test server expires them (no
 * public records are created) — and `testMode: true` guarantees the request
 * never reaches production. This proves that SeqDesk can actually register a
 * study with ENA and receive a real accession, rather than only exercising
 * mocked HTTP.
 *
 * A Webin TEST account is required and is read from the environment, so the
 * test self-skips wherever credentials are not configured (local dev, PRs):
 *
 *   WEBIN_TEST_USERNAME=Webin-XXXXX
 *   WEBIN_TEST_PASSWORD=...
 *
 * Runs in the `live` tier only (see vitest.config.ts), so it never affects the
 * fast unit-test suite.
 */
const username = process.env.WEBIN_TEST_USERNAME?.trim();
const password = process.env.WEBIN_TEST_PASSWORD?.trim();
const hasCredentials = Boolean(username && password);

describe("ENA test-server submission (live)", () => {
  if (!hasCredentials) {
    it.skip("registers a study on the ENA test server (set WEBIN_TEST_USERNAME / WEBIN_TEST_PASSWORD to run)", () => {});
    return;
  }

  it(
    "registers a study on the ENA test server and returns a real accession",
    async () => {
      const result = await submitStudyToENA(
        { username: username as string, password: password as string, testMode: true },
        {
          alias: `seqdesk-ci-${Date.now()}`,
          title: "SeqDesk CI test study",
          description:
            "Automated end-to-end submission to the ENA test server from SeqDesk CI. Temporary test record; expires per ENA test-server policy.",
        },
      );

      // A real accession (PRJ…) confirms ENA accepted and registered the study.
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.accessions?.study).toMatch(/^PRJ/);
    },
    60_000,
  );
});
