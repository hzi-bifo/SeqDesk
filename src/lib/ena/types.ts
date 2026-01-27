// ENA Submission Types

export interface ENACredentials {
  username: string;
  password: string;
  testMode: boolean;
}

export interface StudyData {
  alias: string;
  title: string;
  description: string;
}

export interface SampleData {
  alias: string;
  title: string;
  taxId: string;
  scientificName?: string;
  checklistType?: string;
  attributes?: Record<string, string>;
}

export interface ENASubmissionResult {
  success: boolean;
  receiptXml?: string;
  accessions?: {
    study?: string;
    samples?: Record<string, string>; // alias -> accession
    biosamples?: Record<string, string>; // alias -> biosample
  };
  error?: string;
  rawResponse?: string;
}

export interface ENAReceipt {
  success: boolean;
  receiptDate?: string;
  submissionId?: string;
  messages?: string[];
  projects?: Array<{
    alias: string;
    accession: string;
    extId?: string;
  }>;
  samples?: Array<{
    alias: string;
    accession: string;
    biosample?: string;
  }>;
}
