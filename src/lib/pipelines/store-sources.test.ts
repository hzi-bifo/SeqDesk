import { describe, expect, it } from "vitest";
import {
  getPipelineRegistrySources,
  normalizeRegistryPipeline,
} from "./store-sources";

describe("store source helpers", () => {
  it("parses and de-duplicates configured registry URLs", () => {
    const sources = getPipelineRegistrySources({
      ...process.env,
      SEQDESK_PIPELINE_REGISTRY_URLS:
        "https://seqdesk.org/api/registry, https://example.org/api/registry, https://seqdesk.org/api/registry",
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      registryUrl: "https://seqdesk.org/api/registry",
      label: "SeqDesk Registry",
    });
    expect(sources[1]).toMatchObject({
      registryUrl: "https://example.org/api/registry",
      label: "example.org",
    });
  });

  it("normalizes registry entries with source overrides", () => {
    const normalized = normalizeRegistryPipeline(
      {
        id: "metaxpath",
        name: "MetaxPath",
        latestVersion: "0.1.0",
        isPrivate: true,
        source: {
          kind: "github",
          label: "GitHub",
          repository: "hzi-bifo/MetaxPath",
          refDefault: "Nextflow",
          descriptorPath: ".seqdesk/pipelines/metaxpath",
          includeWorkflow: true,
        },
      },
      {
        id: "registry:https://seqdesk.org/api/registry",
        registryUrl: "https://seqdesk.org/api/registry",
        browseUrl: "https://seqdesk.org/pipelines",
        label: "SeqDesk Registry",
      }
    );

    expect(normalized.source).toMatchObject({
      kind: "github",
      label: "GitHub",
      repository: "hzi-bifo/MetaxPath-Nextflow",
      refDefault: "main",
      includeWorkflow: true,
    });
    expect(normalized.source.sourceId).toBe("github:hzi-bifo/MetaxPath-Nextflow");
  });

  it("falls back to the resolved version download URL when only versions declare it", () => {
    const normalized = normalizeRegistryPipeline(
      {
        id: "mag",
        name: "MAG Pipeline",
        latestVersion: "3.0.0",
        versions: [
          {
            version: "3.0.0",
            downloadUrl: "https://seqdesk.org/api/registry/pipelines/mag/3.0.0/download",
          },
        ],
      },
      {
        id: "registry:https://seqdesk.org/api/registry",
        registryUrl: "https://seqdesk.org/api/registry",
        browseUrl: "https://seqdesk.org/pipelines",
        label: "SeqDesk Registry",
      }
    );

    expect(normalized.downloadUrl).toBe(
      "https://seqdesk.org/api/registry/pipelines/mag/3.0.0/download"
    );
    expect(normalized.source.downloadUrl).toBe(
      "https://seqdesk.org/api/registry/pipelines/mag/3.0.0/download"
    );
  });

  it("treats requiresKey as a private registry source without legacy flags", () => {
    const normalized = normalizeRegistryPipeline(
      {
        id: "licensed-pipeline",
        latestVersion: "1.0.0",
        privateInstall: {
          requiresKey: true,
          packageUrlDefault:
            "https://packages.example/licensed-pipeline.json",
          keyLabel: "Package key",
        },
      },
      {
        id: "registry:https://seqdesk.org/api/registry",
        registryUrl: "https://seqdesk.org/api/registry",
        browseUrl: "https://seqdesk.org/pipelines",
        label: "SeqDesk Registry",
      }
    );

    expect(normalized.isPrivate).toBe(true);
    expect(normalized.source).toMatchObject({
      kind: "privateRegistry",
      packageUrlDefault:
        "https://packages.example/licensed-pipeline.json",
      keyLabel: "Package key",
    });
  });

  it("normalizes partial registry capabilities to the complete response shape", () => {
    const normalized = normalizeRegistryPipeline(
      {
        id: "fastqc",
        capabilities: {
          requiresLinkedReads: true,
          writesCanonicalReadMetadata: true,
          writesCanonicalReadFiles: false,
        },
      },
      {
        id: "registry:https://seqdesk.org/api/registry",
        registryUrl: "https://seqdesk.org/api/registry",
        browseUrl: "https://seqdesk.org/pipelines",
        label: "SeqDesk Registry",
      }
    );

    expect(normalized.capabilities).toEqual({
      requiresLinkedReads: true,
      writesCanonicalReadMetadata: true,
      writesCanonicalReadFiles: false,
      stagesReadCandidates: false,
      requiresAdminReadPromotion: false,
    });
  });
});
