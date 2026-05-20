function trimToUndefined(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const METAXPATH_PIPELINE_ID = "metaxpath";
export const LEGACY_METAXPATH_REPOSITORY = "hzi-bifo/MetaxPath";
export const LEGACY_METAXPATH_REF = "Nextflow";
export const METAXPATH_REPOSITORY =
  trimToUndefined(process.env.SEQDESK_METAXPATH_REPOSITORY) ||
  "hzi-bifo/MetaxPath-Nextflow";
export const DEFAULT_METAXPATH_REF =
  trimToUndefined(process.env.SEQDESK_METAXPATH_REF) ||
  "main";
export const METAXPATH_DESCRIPTOR_RELATIVE_PATH = ".seqdesk/pipelines/metaxpath";

function isManagedMetaxPathRepository(repository?: string | null): boolean {
  const trimmed = trimToUndefined(repository);
  return (
    !trimmed ||
    trimmed === LEGACY_METAXPATH_REPOSITORY ||
    trimmed === METAXPATH_REPOSITORY
  );
}

export function resolveMetaxPathRepository(repository?: string | null): string {
  const trimmed = trimToUndefined(repository);
  if (!trimmed || trimmed === LEGACY_METAXPATH_REPOSITORY) {
    return METAXPATH_REPOSITORY;
  }
  return trimmed;
}

export function resolveMetaxPathRef(
  ref?: string | null,
  repository?: string | null
): string {
  const trimmedRef = trimToUndefined(ref);
  if (!trimmedRef) {
    return DEFAULT_METAXPATH_REF;
  }

  if (
    trimmedRef === LEGACY_METAXPATH_REF &&
    isManagedMetaxPathRepository(repository)
  ) {
    return DEFAULT_METAXPATH_REF;
  }

  return trimmedRef;
}
