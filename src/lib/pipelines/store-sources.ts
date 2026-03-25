import {
  METAXPATH_PIPELINE_ID,
  resolveMetaxPathRef,
  resolveMetaxPathRepository,
} from "./metaxpath-config";
import {
  deriveManifestTargets,
  derivePipelineCapabilities,
  derivePipelineCatalogs,
  type PipelineCapabilities,
  type PipelineCatalog,
  type PackageTargetType,
} from "./package-contracts";
import { getPackageManifest } from "./package-loader";

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
  targets?: {
    supported?: PackageTargetType[];
  };
  capabilities?: Partial<PipelineCapabilities>;
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
  targets: {
    supported: PackageTargetType[];
  } | null;
  catalogs: PipelineCatalog[];
  capabilities: PipelineCapabilities | null;
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
  const resolvedRepository =
    pipeline.id === METAXPATH_PIPELINE_ID && sourceKind === "github"
      ? resolveMetaxPathRepository(pipeline.source?.repository)
      : pipeline.source?.repository;
  const resolvedRefDefault =
    pipeline.id === METAXPATH_PIPELINE_ID && sourceKind === "github"
      ? resolveMetaxPathRef(pipeline.source?.refDefault, pipeline.source?.repository)
      : pipeline.source?.refDefault;
  const source: PipelineSourceDescriptor = {
    kind: sourceKind,
    sourceId:
      sourceKind === "registry" || sourceKind === "privateRegistry"
        ? registry.id
        : `github:${resolvedRepository || pipeline.id}`,
    label: pipeline.source?.label || registry.label,
    registryUrl: registry.registryUrl,
    browseUrl: registry.browseUrl,
    downloadUrl: resolvedDownloadUrl,
    packageUrlDefault:
      pipeline.source?.packageUrlDefault || pipeline.privateInstall?.packageUrlDefault,
    keyLabel: pipeline.source?.keyLabel || pipeline.privateInstall?.keyLabel,
    repository: resolvedRepository,
    refDefault: resolvedRefDefault,
    descriptorPath: pipeline.source?.descriptorPath,
    includeWorkflow: pipeline.source?.includeWorkflow,
  };
  const localManifest = getPackageManifest(pipeline.id);
  const localTargets = deriveManifestTargets(localManifest);
  const supportedTargets = localTargets.length > 0
    ? localTargets
    : Array.isArray(pipeline.targets?.supported)
      ? pipeline.targets.supported
      : [];
  const catalogs = derivePipelineCatalogs(supportedTargets);
  const capabilities = localManifest
    ? derivePipelineCapabilities(localManifest)
    : pipeline.capabilities
      ? {
          requiresLinkedReads: pipeline.capabilities.requiresLinkedReads === true,
          writesCanonicalReadMetadata:
            pipeline.capabilities.writesCanonicalReadMetadata === true,
          writesCanonicalReadFiles:
            pipeline.capabilities.writesCanonicalReadFiles === true,
        }
      : null;

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
    targets: supportedTargets.length > 0 ? { supported: supportedTargets } : null,
    catalogs,
    capabilities,
    source,
  };
}
