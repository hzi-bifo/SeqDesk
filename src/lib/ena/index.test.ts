import { describe, expect, it } from "vitest";

import * as enaIndex from "./index";
import {
  getENAUrl,
  submitSamplesToENA,
  submitStudyAndSamplesToENA,
  submitStudyToENA,
} from "./api-client";
import {
  generateSampleXml,
  generateStudyXml,
  generateSubmissionXml,
  parseReceiptXml,
} from "./xml-generator";

describe("ena index barrel exports", () => {
  it("re-exports API client functions", () => {
    expect(enaIndex.getENAUrl).toBe(getENAUrl);
    expect(enaIndex.submitStudyToENA).toBe(submitStudyToENA);
    expect(enaIndex.submitSamplesToENA).toBe(submitSamplesToENA);
    expect(enaIndex.submitStudyAndSamplesToENA).toBe(submitStudyAndSamplesToENA);
  });

  it("re-exports XML generator functions", () => {
    expect(enaIndex.generateStudyXml).toBe(generateStudyXml);
    expect(enaIndex.generateSampleXml).toBe(generateSampleXml);
    expect(enaIndex.generateSubmissionXml).toBe(generateSubmissionXml);
    expect(enaIndex.parseReceiptXml).toBe(parseReceiptXml);
  });
});
