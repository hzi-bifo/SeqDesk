export type CoreSampleColumn =
  | "sampleAlias"
  | "sampleTitle"
  | "sampleDescription"
  | "scientificName"
  | "taxId";

// Mapping from per-sample field names to Sample model column names.
// This allows form builder fields to map to actual database columns.
export const FIELD_TO_COLUMN_MAP: Record<string, CoreSampleColumn> = {
  sample_alias: "sampleAlias",
  sample_title: "sampleTitle",
  sample_description: "sampleDescription",
  scientific_name: "scientificName",
  tax_id: "taxId",
  // Direct mappings (if field name matches column name)
  sampleAlias: "sampleAlias",
  sampleTitle: "sampleTitle",
  sampleDescription: "sampleDescription",
  scientificName: "scientificName",
  taxId: "taxId",
  // ENA module fields (with underscore prefix)
  _sampleAlias: "sampleAlias",
  _sampleTitle: "sampleTitle",
  // Organism field (special type that maps to both taxId and scientificName)
  organism: "taxId",
  _organism: "taxId",
};

export function mapPerSampleFieldToColumn(
  fieldName: string
): CoreSampleColumn | undefined {
  return FIELD_TO_COLUMN_MAP[fieldName];
}
