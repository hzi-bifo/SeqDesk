import { z } from "zod";
import {
  getPipelineRegistrySources,
  normalizeRegistryPipeline,
  type RegistryApiResponse,
  type RegistryCategoryEntry,
  type RegistryPipelineEntry,
  type RegistrySourceConfig,
  type StorePipelineResponse,
} from "./store-sources";
import {
  matchesPipelineCatalog,
  type PipelineCatalog,
} from "./package-contracts";

export const DEFAULT_REGISTRY_FETCH_TIMEOUT_MS = 10_000;

export interface PipelineStoreSourceError {
  sourceId: string;
  label: string;
  registryUrl: string;
  error: string;
}

export interface DuplicatePipelineRegistryEntry {
  pipelineId: string;
  sources: Array<{
    sourceId: string;
    label: string;
    registryUrl: string;
  }>;
  entries: StorePipelineResponse[];
}

export interface PipelineStoreCatalog {
  registries: RegistrySourceConfig[];
  pipelines: StorePipelineResponse[];
  categories: RegistryCategoryEntry[];
  lastUpdated?: string;
  version?: string;
  registryErrors: PipelineStoreSourceError[];
  duplicatePipelineIds: DuplicatePipelineRegistryEntry[];
  successfulRegistryCount: number;
}

export interface LoadPipelineStoreCatalogOptions {
  catalog?: PipelineCatalog | "all";
  registrySources?: RegistrySourceConfig[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface LoadedRegistry {
  registry: RegistrySourceConfig;
  data: RegistryApiResponse;
  pipelines: StorePipelineResponse[];
  categories: RegistryCategoryEntry[];
  warnings: PipelineStoreSourceError[];
}

type RegistryLoadResult =
  | { ok: true; value: LoadedRegistry }
  | { ok: false; error: PipelineStoreSourceError };

export function parsePipelineCatalog(
  value: string | null | undefined
): PipelineCatalog | "all" | null {
  if (!value || value === "all") return "all";
  if (value === "order" || value === "study") return value;
  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RegistryPipelineSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().optional(),
    shortDescription: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),
    provider: z.string().optional(),
    latestVersion: z.string().optional(),
    version: z.string().optional(),
    versions: z
      .array(
        z
          .object({
            version: z.string().trim().min(1),
            downloadUrl: z.string().trim().min(1).optional(),
            sha256: z.string().trim().min(1).optional(),
          })
          .passthrough()
      )
      .optional(),
    downloads: z.number().optional(),
    rating: z.number().optional(),
    verified: z.boolean().optional(),
    icon: z.string().optional(),
    featured: z.boolean().optional(),
    downloadUrl: z.string().trim().min(1).optional(),
    sha256: z.string().trim().min(1).optional(),
    isPrivate: z.boolean().optional(),
    licenseRequired: z.boolean().optional(),
    targets: z
      .object({
        supported: z.array(z.enum(["study", "order"])).optional(),
      })
      .passthrough()
      .optional(),
    capabilities: z
      .object({
        requiresLinkedReads: z.boolean().optional(),
        writesCanonicalReadMetadata: z.boolean().optional(),
        writesCanonicalReadFiles: z.boolean().optional(),
        stagesReadCandidates: z.boolean().optional(),
        requiresAdminReadPromotion: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    source: z
      .object({
        kind: z.enum(["registry", "privateRegistry", "github"]).optional(),
        label: z.string().optional(),
        downloadUrl: z.string().trim().min(1).optional(),
        sha256: z.string().trim().min(1).optional(),
        packageUrlDefault: z.string().trim().min(1).optional(),
        keyLabel: z.string().optional(),
        repository: z.string().optional(),
        refDefault: z.string().optional(),
        descriptorPath: z.string().optional(),
        includeWorkflow: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    privateInstall: z
      .object({
        requiresKey: z.boolean().optional(),
        packageUrlDefault: z.string().trim().min(1).optional(),
        keyLabel: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function parseRegistryPayload(
  payload: unknown,
  registry: RegistrySourceConfig
): { data: RegistryApiResponse; warnings: PipelineStoreSourceError[] } {
  if (!isRecord(payload)) {
    throw new Error("Registry returned an invalid JSON object");
  }
  if (payload.pipelines !== undefined && !Array.isArray(payload.pipelines)) {
    throw new Error("Registry pipelines must be an array");
  }
  if (payload.categories !== undefined && !Array.isArray(payload.categories)) {
    throw new Error("Registry categories must be an array");
  }

  for (const [index, category] of (payload.categories || []).entries()) {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      category.id.trim().length === 0 ||
      typeof category.name !== "string" ||
      category.name.trim().length === 0
    ) {
      throw new Error(`Registry category at index ${index} is invalid`);
    }
  }

  const pipelines: RegistryPipelineEntry[] = [];
  const warnings: PipelineStoreSourceError[] = [];
  for (const [index, pipeline] of (payload.pipelines || []).entries()) {
    const result = RegistryPipelineSchema.safeParse(pipeline);
    if (result.success) {
      const entry = result.data as RegistryPipelineEntry;
      const sourceKind =
        entry.source?.kind ||
        (entry.isPrivate === true ||
          entry.licenseRequired === true ||
          entry.privateInstall?.requiresKey === true
          ? "privateRegistry"
          : "registry");
      const hasDownloadUrl = Boolean(
        entry.source?.downloadUrl ||
          entry.downloadUrl ||
          entry.versions?.some((version) => version.downloadUrl)
      );
      if (sourceKind === "registry" && !hasDownloadUrl) {
        warnings.push({
          sourceId: registry.id,
          label: registry.label,
          registryUrl: registry.registryUrl,
          error: `Skipped pipeline "${entry.id}": registry installs require a download URL.`,
        });
        continue;
      }
      pipelines.push(entry);
      continue;
    }

    warnings.push({
      sourceId: registry.id,
      label: registry.label,
      registryUrl: registry.registryUrl,
      error: `Skipped invalid pipeline at index ${index}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "entry"}: ${issue.message}`)
        .join("; ")}`,
    });
  }

  return {
    data: {
      version: typeof payload.version === "string" ? payload.version : undefined,
      lastUpdated:
        typeof payload.lastUpdated === "string"
          ? payload.lastUpdated
          : undefined,
      pipelines,
      categories: (payload.categories || []) as RegistryCategoryEntry[],
    },
    warnings,
  };
}

async function loadRegistry(
  registry: RegistrySourceConfig,
  catalog: PipelineCatalog | "all",
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<RegistryLoadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(registry.registryUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const parsed = parseRegistryPayload(await response.json(), registry);
    const data = parsed.data;
    const pipelines = (data.pipelines || [])
      .map((pipeline) => normalizeRegistryPipeline(pipeline, registry))
      .filter((pipeline) =>
        matchesPipelineCatalog(pipeline.catalogs, catalog)
      );

    return {
      ok: true,
      value: {
        registry,
        data,
        pipelines,
        categories: data.categories || [],
        warnings: parsed.warnings,
      },
    };
  } catch (error) {
    const details = controller.signal.aborted
      ? `Request timed out after ${timeoutMs}ms`
      : describeError(error);
    return {
      ok: false,
      error: {
        sourceId: registry.id,
        label: registry.label,
        registryUrl: registry.registryUrl,
        error: details,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveUniquePipelines(
  responses: LoadedRegistry[]
): {
  pipelines: StorePipelineResponse[];
  duplicates: DuplicatePipelineRegistryEntry[];
  warnings: PipelineStoreSourceError[];
} {
  const entriesById = new Map<
    string,
    Array<{ pipeline: StorePipelineResponse; registry: RegistrySourceConfig }>
  >();

  for (const response of responses) {
    for (const pipeline of response.pipelines) {
      const entries = entriesById.get(pipeline.id) || [];
      entries.push({ pipeline, registry: response.registry });
      entriesById.set(pipeline.id, entries);
    }
  }

  const pipelines: StorePipelineResponse[] = [];
  const duplicates: DuplicatePipelineRegistryEntry[] = [];
  const warnings: PipelineStoreSourceError[] = [];
  for (const [pipelineId, entries] of entriesById) {
    if (entries.length === 1) {
      pipelines.push(entries[0].pipeline);
      continue;
    }

    const sources = entries.map(({ registry }) => ({
      sourceId: registry.id,
      label: registry.label,
      registryUrl: registry.registryUrl,
    }));
    duplicates.push({
      pipelineId,
      sources,
      entries: entries.map((entry) => entry.pipeline),
    });
    for (const source of sources) {
      warnings.push({
        ...source,
        error: `Duplicate pipeline ID "${pipelineId}" was returned by ${sources
          .map((entry) => entry.registryUrl)
          .join(", ")}; the ambiguous Store entry was omitted.`,
      });
    }
  }

  return { pipelines, duplicates, warnings };
}

export async function loadPipelineStoreCatalog(
  options: LoadPipelineStoreCatalogOptions = {}
): Promise<PipelineStoreCatalog> {
  const catalog = options.catalog ?? "all";
  const registrySources =
    options.registrySources ||
    getPipelineRegistrySources(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_REGISTRY_FETCH_TIMEOUT_MS;

  const results = await Promise.all(
    registrySources.map((registry) =>
      loadRegistry(registry, catalog, fetchImpl, timeoutMs)
    )
  );
  const responses = results
    .filter(
      (result): result is Extract<RegistryLoadResult, { ok: true }> =>
        result.ok
    )
    .map((result) => result.value);
  const sourceErrors = results
    .filter(
      (result): result is Extract<RegistryLoadResult, { ok: false }> =>
        !result.ok
    )
    .map((result) => result.error)
    .concat(responses.flatMap((response) => response.warnings));
  const uniquePipelines = resolveUniquePipelines(responses);

  const categoryMap = new Map<string, RegistryCategoryEntry>();
  for (const response of responses) {
    for (const category of response.categories) {
      if (!categoryMap.has(category.id)) {
        categoryMap.set(category.id, category);
      }
    }
  }

  return {
    registries: registrySources,
    pipelines: uniquePipelines.pipelines,
    categories: Array.from(categoryMap.values()),
    lastUpdated: responses
      .map((entry) => entry.data.lastUpdated)
      .filter((value): value is string => typeof value === "string")
      .sort()
      .at(-1),
    version: responses
      .map((entry) => entry.data.version)
      .filter((value): value is string => typeof value === "string")
      .at(0),
    registryErrors: sourceErrors.concat(uniquePipelines.warnings),
    duplicatePipelineIds: uniquePipelines.duplicates,
    successfulRegistryCount: responses.length,
  };
}

export function findUniqueStorePipeline(
  catalog: PipelineStoreCatalog,
  pipelineId: string,
  selectors: {
    sourceId?: string;
    version?: string;
  } = {}
): StorePipelineResponse | null {
  const duplicate = catalog.duplicatePipelineIds.find(
    (entry) => entry.pipelineId === pipelineId
  );
  let candidates = duplicate
    ? duplicate.entries
    : catalog.pipelines.filter((pipeline) => pipeline.id === pipelineId);

  if (selectors.sourceId) {
    candidates = candidates.filter(
      (pipeline) => pipeline.source.sourceId === selectors.sourceId
    );
  }
  if (selectors.version) {
    candidates = candidates
      .map((pipeline) =>
        selectStorePipelineVersion(pipeline, selectors.version as string)
      )
      .filter(
        (pipeline): pipeline is StorePipelineResponse => pipeline !== null
      );
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function selectStorePipelineVersion(
  pipeline: StorePipelineResponse,
  version: string
): StorePipelineResponse | null {
  if (pipeline.version === version || pipeline.latestVersion === version) {
    return pipeline;
  }
  const versionEntry = pipeline.versions.find(
    (entry) => entry.version === version
  );
  if (!versionEntry) return null;
  return {
    ...pipeline,
    version,
    latestVersion: pipeline.latestVersion,
    downloadUrl: versionEntry.downloadUrl,
    source: {
      ...pipeline.source,
      downloadUrl: versionEntry.downloadUrl,
      sha256: versionEntry.sha256,
    },
  };
}
