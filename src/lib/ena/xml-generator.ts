import { StudyData, SampleData } from "./types";

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Map internal field names to ENA expected field names
 * ENA has specific field name requirements for certain attributes
 */
const ENA_FIELD_NAME_MAP: Record<string, string> = {
  // Date fields - various possible naming conventions
  "collection_date": "collection date",
  "collectionDate": "collection date",
  "Collection Date": "collection date",

  // Geographic location - ENA requires the full format
  // Various naming conventions from different templates
  "geo_loc_name_country": "geographic location (country and/or sea)",
  "geo_loc_name": "geographic location (country and/or sea)",
  "geographic_location": "geographic location (country and/or sea)",
  "geographicLocation": "geographic location (country and/or sea)",
  "country": "geographic location (country and/or sea)",
  "geographic_location_country_and_or_sea": "geographic location (country and/or sea)",
  "Geographic Location (Country)": "geographic location (country and/or sea)",

  // Coordinates
  "lat_lon": "geographic location (latitude)",
  "latitude": "geographic location (latitude)",
  "geographic_location_latitude": "geographic location (latitude)",
  "longitude": "geographic location (longitude)",
  "geographic_location_longitude": "geographic location (longitude)",

  // Other common MIxS fields
  "depth": "depth",
  "altitude": "altitude",
  "elevation": "elevation",
  "env_broad_scale": "broad-scale environmental context",
  "env_local_scale": "local environmental context",
  "env_medium": "environmental medium",
  "isolation_source": "isolation source",
  "host": "host",
  "host_scientific_name": "host scientific name",
};

/**
 * Convert internal field name to ENA expected field name
 */
function toEnaFieldName(fieldName: string): string {
  return ENA_FIELD_NAME_MAP[fieldName] || fieldName;
}

/**
 * Generate Study/Project XML for ENA submission
 */
export function generateStudyXml(study: StudyData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PROJECT_SET>
  <PROJECT alias="${escapeXml(study.alias)}">
    <TITLE>${escapeXml(study.title)}</TITLE>
    <DESCRIPTION>${escapeXml(study.description)}</DESCRIPTION>
    <SUBMISSION_PROJECT>
      <SEQUENCING_PROJECT/>
    </SUBMISSION_PROJECT>
  </PROJECT>
</PROJECT_SET>`;
}

/**
 * Generate Sample XML for ENA submission
 */
export function generateSampleXml(samples: SampleData[]): string {
  const sampleElements = samples.map((sample) => {
    // Generate sample attributes
    const attributeElements: string[] = [];

    // Add checklist type if provided
    if (sample.checklistType) {
      attributeElements.push(`      <SAMPLE_ATTRIBUTE>
        <TAG>ENA-CHECKLIST</TAG>
        <VALUE>${escapeXml(sample.checklistType)}</VALUE>
      </SAMPLE_ATTRIBUTE>`);
    }

    // Add custom attributes - map field names to ENA expected names
    if (sample.attributes) {
      for (const [key, value] of Object.entries(sample.attributes)) {
        if (value && value.trim()) {
          const enaFieldName = toEnaFieldName(key);
          attributeElements.push(`      <SAMPLE_ATTRIBUTE>
        <TAG>${escapeXml(enaFieldName)}</TAG>
        <VALUE>${escapeXml(value)}</VALUE>
      </SAMPLE_ATTRIBUTE>`);
        }
      }
    }

    const attributesBlock =
      attributeElements.length > 0
        ? `
    <SAMPLE_ATTRIBUTES>
${attributeElements.join("\n")}
    </SAMPLE_ATTRIBUTES>`
        : "";

    return `  <SAMPLE alias="${escapeXml(sample.alias)}">
    <TITLE>${escapeXml(sample.title)}</TITLE>
    <SAMPLE_NAME>
      <TAXON_ID>${escapeXml(sample.taxId)}</TAXON_ID>${
        sample.scientificName
          ? `
      <SCIENTIFIC_NAME>${escapeXml(sample.scientificName)}</SCIENTIFIC_NAME>`
          : ""
      }
    </SAMPLE_NAME>${attributesBlock}
  </SAMPLE>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<SAMPLE_SET>
${sampleElements.join("\n")}
</SAMPLE_SET>`;
}

/**
 * Generate Submission XML for ENA
 * This wraps the actual submission with actions
 */
export function generateSubmissionXml(
  action: "ADD" | "MODIFY" | "VALIDATE" = "ADD",
  holdDate?: string
): string {
  // Optional HOLD action for embargo
  const holdAction = holdDate
    ? `
      <ACTION>
        <HOLD HoldUntilDate="${holdDate}"/>
      </ACTION>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<SUBMISSION>
  <ACTIONS>
    <ACTION>
      <${action}/>
    </ACTION>${holdAction}
  </ACTIONS>
</SUBMISSION>`;
}

/**
 * Parse ENA receipt XML to extract accession numbers
 */
export function parseReceiptXml(receiptXml: string): {
  success: boolean;
  receiptDate?: string;
  submissionId?: string;
  messages: string[];
  projects: Array<{ alias: string; accession: string; extId?: string }>;
  samples: Array<{ alias: string; accession: string; biosample?: string }>;
  errors: string[];
} {
  const extractElementSection = (
    xml: string,
    startIndex: number,
    closingTag: string
  ): string => {
    const openTagEnd = xml.indexOf(">", startIndex);
    if (openTagEnd === -1) {
      return "";
    }

    const openingTag = xml.slice(startIndex, openTagEnd + 1);
    if (openingTag.endsWith("/>")) {
      return openingTag;
    }

    const closeTagIndex = xml.indexOf(closingTag, openTagEnd + 1);
    if (closeTagIndex === -1) {
      return openingTag;
    }

    return xml.slice(startIndex, closeTagIndex + closingTag.length);
  };

  const result = {
    success: false,
    receiptDate: undefined as string | undefined,
    submissionId: undefined as string | undefined,
    messages: [] as string[],
    projects: [] as Array<{ alias: string; accession: string; extId?: string }>,
    samples: [] as Array<{ alias: string; accession: string; biosample?: string }>,
    errors: [] as string[],
  };

  try {
    // Parse success attribute
    const successMatch = receiptXml.match(/success="(true|false)"/i);
    result.success = successMatch?.[1]?.toLowerCase() === "true";

    // Parse receipt date
    const dateMatch = receiptXml.match(/receiptDate="([^"]+)"/);
    result.receiptDate = dateMatch?.[1];

    // Parse submission ID
    const submissionMatch = receiptXml.match(/submissionId="([^"]+)"/);
    result.submissionId = submissionMatch?.[1];

    // Parse PROJECT elements - handle attributes in any order and self-closing tags
    // Matches both <PROJECT ... > and <PROJECT ... />
    const projectTagRegex = /<PROJECT([^>]*?)\/?>/gi;
    let projectTagMatch;
    while ((projectTagMatch = projectTagRegex.exec(receiptXml)) !== null) {
      const attrs = projectTagMatch[1];
      const aliasMatch = attrs.match(/alias="([^"]*)"/i);
      const accessionMatch = attrs.match(/accession="([^"]*)"/i);

      if (accessionMatch) {
        const alias = aliasMatch?.[1] || "";
        const accession = accessionMatch[1];

        const projectSection = extractElementSection(
          receiptXml,
          projectTagMatch.index,
          "</PROJECT>"
        );
        const extIdMatch = projectSection.match(/<EXT_ID[^>]*accession="([^"]*)"/i);

        result.projects.push({
          alias,
          accession,
          extId: extIdMatch?.[1],
        });
      }
    }

    // Parse SAMPLE elements - handle attributes in any order and self-closing tags
    // Matches both <SAMPLE ... > and <SAMPLE ... />
    const sampleTagRegex = /<SAMPLE([^>]*?)\/?>/gi;
    let sampleTagMatch;
    while ((sampleTagMatch = sampleTagRegex.exec(receiptXml)) !== null) {
      const attrs = sampleTagMatch[1];
      const aliasMatch = attrs.match(/alias="([^"]*)"/i);
      const accessionMatch = attrs.match(/accession="([^"]*)"/i);

      if (accessionMatch) {
        const alias = aliasMatch?.[1] || "";
        const accession = accessionMatch[1];

        const sampleSection = extractElementSection(
          receiptXml,
          sampleTagMatch.index,
          "</SAMPLE>"
        );
        const biosampleMatch = sampleSection.match(/<EXT_ID[^>]*accession="([^"]*)"/i);

        result.samples.push({
          alias,
          accession,
          biosample: biosampleMatch?.[1],
        });
      }
    }

    // Parse error messages
    const errorRegex = /<ERROR>([^<]*)<\/ERROR>/gi;
    let errorMatch;
    while ((errorMatch = errorRegex.exec(receiptXml)) !== null) {
      result.errors.push(errorMatch[1]);
    }

    // Parse info messages
    const infoRegex = /<INFO>([^<]*)<\/INFO>/gi;
    let infoMatch;
    while ((infoMatch = infoRegex.exec(receiptXml)) !== null) {
      result.messages.push(infoMatch[1]);
    }
  } catch (error) {
    console.error("Error parsing ENA receipt XML:", error);
    result.errors.push("Failed to parse ENA receipt XML");
  }

  return result;
}
