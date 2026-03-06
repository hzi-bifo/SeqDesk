export type PipelineSourceKind = "registry" | "privateRegistry" | "github";

export interface PipelineSourceDescriptor {
  kind: PipelineSourceKind;
  sourceId: string;
  label: string;
  registryUrl?: string;
  browseUrl?: string;
  downloadUrl?: string;
  packageUrlDefault?: string;
  keyLabel?: string;
  repository?: string;
  refDefault?: string;
  descriptorPath?: string;
  includeWorkflow?: boolean;
}

export interface RegistryPipelineVersion {
  version: string;
  downloadUrl?: string;
}

export interface RegistryPipelineSourceOverride {
  kind?: PipelineSourceKind;
  label?: string;
  downloadUrl?: string;
  packageUrlDefault?: string;
  keyLabel?: string;
  repository?: string;
  refDefault?: string;
  descriptorPath?: string;
  includeWorkflow?: boolean;
}

export interface RegistryPipelineEntry {
  id: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  category?: string;
  tags?: string[];
  author?: string;
  provider?: string;
  latestVersion?: string;
  version?: string;
  versions?: RegistryPipelineVersion[];
  downloads?: number;
  rating?: number;
  verified?: boolean;
  icon?: string;
  featured?: boolean;
  downloadUrl?: string;
  isPrivate?: boolean;
  licenseRequired?: boolean;
  source?: RegistryPipelineSourceOverride;
  privateInstall?: {
    requiresKey?: boolean;
    packageUrlDefault?: string;
    keyLabel?: string;
  };
}

export interface RegistryCategoryEntry {
  id: string;
  name: string;
  description?: string;
}

export interface RegistryApiResponse {
  version?: string;
  lastUpdated?: string;
  pipelines?: RegistryPipelineEntry[];
  categories?: RegistryCategoryEntry[];
}

export interface RegistrySourceConfig {
  id: string;
  registryUrl: string;
  browseUrl: string;
  label: string;
}

export interface StorePipelineResponse {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  latestVersion: string;
  versions: RegistryPipelineVersion[];
  author: string;
  downloads: number;
  rating?: number;
  verified: boolean;
  icon: string;
  featured: boolean;
  downloadUrl?: string;
  tags: string[];
  isPrivate: boolean;
  licenseRequired: boolean;
  source: PipelineSourceDescriptor;
}

function trimToUndefined(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sourceIdFromRegistryUrl(registryUrl: string): string {
  return `registry:${registryUrl}`;
}

function buildBrowseUrl(registryUrl: string): string {
  if (registryUrl.endsWith("/api/registry")) {
    return registryUrl.slice(0, -"/api/registry".length) + "/pipelines";
  }
  return registryUrl;
}

function buildRegistryLabel(registryUrl: string): string {
  try {
    const host = new URL(registryUrl).host;
    return host === "seqdesk.com" || host === "www.seqdesk.com"
      ? "SeqDesk Registry"
      : host;
  } catch {
    return registryUrl;
  }
}

export function getPipelineRegistrySources(
  env: NodeJS.ProcessEnv = process.env
): RegistrySourceConfig[] {
  const storeBaseUrl =
    trimToUndefined(env.SEQDESK_PIPELINE_STORE_URL) || "https://seqdesk.com";
  const singleRegistryUrl =
    trimToUndefined(env.SEQDESK_PIPELINE_REGISTRY_URL) ||
    `${storeBaseUrl}/api/registry`;
  const combined = trimToUndefined(env.SEQDESK_PIPELINE_REGISTRY_URLS);
  const registryUrls = combined
    ? combined
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [singleRegistryUrl];

  const seen = new Set<string>();
  return registryUrls
    .filter((registryUrl) => {
      if (seen.has(registryUrl)) return false;
      seen.add(registryUrl);
      return true;
    })
    .map((registryUrl) => ({
      id: sourceIdFromRegistryUrl(registryUrl),
      registryUrl,
      browseUrl: buildBrowseUrl(registryUrl),
      label: buildRegistryLabel(registryUrl),
    }));
}

export function normalizeRegistryPipeline(
  pipeline: RegistryPipelineEntry,
  registry: RegistrySourceConfig
): StorePipelineResponse {
  const version =
    pipeline.latestVersion ||
    pipeline.version ||
    pipeline.versions?.[0]?.version ||
    "unknown";
  const sourceKind = pipeline.source?.kind
    ? pipeline.source.kind
    : pipeline.isPrivate === true || pipeline.licenseRequired === true
      ? "privateRegistry"
      : "registry";
  const matchingVersionEntry =
    pipeline.versions?.find((entry) => entry.version === version) ||
    pipeline.versions?.[0];
  const resolvedDownloadUrl =
    pipeline.source?.downloadUrl || pipeline.downloadUrl || matchingVersionEntry?.downloadUrl;
  const source: PipelineSourceDescriptor = {
    kind: sourceKind,
    sourceId:
      sourceKind === "registry" || sourceKind === "privateRegistry"
        ? registry.id
        : `github:${pipeline.source?.repository || pipeline.id}`,
    label: pipeline.source?.label || registry.label,
    registryUrl: registry.registryUrl,
    browseUrl: registry.browseUrl,
    downloadUrl: resolvedDownloadUrl,
    packageUrlDefault:
      pipeline.source?.packageUrlDefault || pipeline.privateInstall?.packageUrlDefault,
    keyLabel: pipeline.source?.keyLabel || pipeline.privateInstall?.keyLabel,
    repository: pipeline.source?.repository,
    refDefault: pipeline.source?.refDefault,
    descriptorPath: pipeline.source?.descriptorPath,
    includeWorkflow: pipeline.source?.includeWorkflow,
  };

  return {
    id: pipeline.id,
    name: pipeline.name || pipeline.id,
    description: pipeline.shortDescription || pipeline.description || "",
    category: pipeline.category || "analysis",
    version,
    latestVersion: version,
    versions: pipeline.versions || [],
    author: pipeline.author || pipeline.provider || "unknown",
    downloads: pipeline.downloads || 0,
    rating: pipeline.rating,
    verified: pipeline.verified || false,
    icon: pipeline.icon || "pipeline",
    featured: pipeline.featured || false,
    downloadUrl: resolvedDownloadUrl,
    tags: pipeline.tags || [],
    isPrivate: pipeline.isPrivate === true,
    licenseRequired: pipeline.licenseRequired === true,
    source,
  };
}
