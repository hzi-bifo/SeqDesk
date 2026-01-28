import { ENACredentials, ENASubmissionResult, StudyData, SampleData } from "./types";
import {
  generateStudyXml,
  generateSampleXml,
  generateSubmissionXml,
  parseReceiptXml,
} from "./xml-generator";

const ENA_TEST_URL = "https://wwwdev.ebi.ac.uk/ena/submit/drop-box/submit/";
const ENA_PROD_URL = "https://www.ebi.ac.uk/ena/submit/drop-box/submit/";

/**
 * Get ENA submission URL based on test mode
 */
export function getENAUrl(testMode: boolean): string {
  return testMode ? ENA_TEST_URL : ENA_PROD_URL;
}

/**
 * Create multipart form data for ENA submission
 * ENA expects files to be uploaded as multipart form data
 */
function createFormData(
  submissionXml: string,
  contentType: "PROJECT" | "SAMPLE",
  contentXml: string
): FormData {
  const formData = new FormData();

  // Add submission XML as file
  const submissionBlob = new Blob([submissionXml], { type: "application/xml" });
  formData.append("SUBMISSION", submissionBlob, "submission.xml");

  // Add content XML as file
  const contentBlob = new Blob([contentXml], { type: "application/xml" });
  formData.append(contentType, contentBlob, `${contentType.toLowerCase()}.xml`);

  return formData;
}

/**
 * Submit to ENA API
 */
async function submitToENA(
  credentials: ENACredentials,
  formData: FormData
): Promise<{
  success: boolean;
  status: number;
  responseText: string;
}> {
  const url = getENAUrl(credentials.testMode);
  const authString = Buffer.from(
    `${credentials.username}:${credentials.password}`
  ).toString("base64");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
      },
      body: formData,
    });

    const responseText = await response.text();

    return {
      success: response.ok,
      status: response.status,
      responseText,
    };
  } catch (error) {
    console.error("ENA submission error:", error);
    throw error;
  }
}

/**
 * Submit a study (project) to ENA
 */
export async function submitStudyToENA(
  credentials: ENACredentials,
  study: StudyData
): Promise<ENASubmissionResult> {
  try {
    // Generate XML files
    const studyXml = generateStudyXml(study);
    const submissionXml = generateSubmissionXml("ADD");

    // Create form data
    const formData = createFormData(submissionXml, "PROJECT", studyXml);

    // Submit to ENA
    const response = await submitToENA(credentials, formData);

    if (!response.success && response.status === 401) {
      return {
        success: false,
        error: "Authentication failed - invalid ENA credentials",
        rawResponse: response.responseText,
      };
    }

    // Parse the receipt
    const receipt = parseReceiptXml(response.responseText);

    console.log("ENA Study Receipt:", {
      success: receipt.success,
      projectsFound: receipt.projects.length,
      projects: receipt.projects,
      errors: receipt.errors,
      rawXml: response.responseText.substring(0, 500),
    });

    if (!receipt.success) {
      return {
        success: false,
        error: receipt.errors.join("; ") || "ENA submission failed",
        receiptXml: response.responseText,
        rawResponse: response.responseText,
      };
    }

    // Extract accession numbers
    const accessions: ENASubmissionResult["accessions"] = {};
    if (receipt.projects.length > 0) {
      const project = receipt.projects.find((p) => p.alias === study.alias) ||
        receipt.projects[0];
      accessions.study = project.accession;
      console.log("Extracted study accession:", accessions.study);
    } else {
      console.warn("No PROJECT elements found in ENA receipt, raw XML:", response.responseText);
    }

    return {
      success: true,
      receiptXml: response.responseText,
      accessions,
      rawResponse: response.responseText,
    };
  } catch (error) {
    console.error("Error submitting study to ENA:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Submit samples to ENA
 */
export async function submitSamplesToENA(
  credentials: ENACredentials,
  samples: SampleData[]
): Promise<ENASubmissionResult> {
  try {
    // Generate XML files
    const samplesXml = generateSampleXml(samples);
    const submissionXml = generateSubmissionXml("ADD");

    // Create form data
    const formData = createFormData(submissionXml, "SAMPLE", samplesXml);

    // Submit to ENA
    const response = await submitToENA(credentials, formData);

    if (!response.success && response.status === 401) {
      return {
        success: false,
        error: "Authentication failed - invalid ENA credentials",
        rawResponse: response.responseText,
      };
    }

    // Parse the receipt
    const receipt = parseReceiptXml(response.responseText);

    if (!receipt.success) {
      return {
        success: false,
        error: receipt.errors.join("; ") || "ENA submission failed",
        receiptXml: response.responseText,
        rawResponse: response.responseText,
      };
    }

    // Extract accession numbers
    const accessions: ENASubmissionResult["accessions"] = {
      samples: {},
      biosamples: {},
    };

    for (const sample of receipt.samples) {
      if (accessions.samples) {
        accessions.samples[sample.alias] = sample.accession;
      }
      if (sample.biosample && accessions.biosamples) {
        accessions.biosamples[sample.alias] = sample.biosample;
      }
    }

    return {
      success: true,
      receiptXml: response.responseText,
      accessions,
      rawResponse: response.responseText,
    };
  } catch (error) {
    console.error("Error submitting samples to ENA:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Submit study and samples together
 * This is the main function for a complete submission
 */
export async function submitStudyAndSamplesToENA(
  credentials: ENACredentials,
  study: StudyData,
  samples: SampleData[]
): Promise<{
  studyResult: ENASubmissionResult;
  samplesResult: ENASubmissionResult | null;
}> {
  // First submit the study
  const studyResult = await submitStudyToENA(credentials, study);

  if (!studyResult.success) {
    return {
      studyResult,
      samplesResult: null,
    };
  }

  // Then submit samples
  const samplesResult = await submitSamplesToENA(credentials, samples);

  return {
    studyResult,
    samplesResult,
  };
}
