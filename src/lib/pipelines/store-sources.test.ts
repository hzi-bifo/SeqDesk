import { describe, expect, it } from "vitest";
import {
  getPipelineRegistrySources,
  normalizeRegistryPipeline,
} from "./store-sources";

describe("store source helpers", () => {
  it("parses and de-duplicates configured registry URLs", () => {
    const sources = getPipelineRegistrySources({
      SEQDESK_PIPELINE_REGISTRY_URLS:
        "https://seqdesk.com/api/registry, https://example.org/api/registry, https://seqdesk.com/api/registry",
    } as NodeJS.ProcessEnv);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      registryUrl: "https://seqdesk.com/api/registry",
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
        id: "registry:https://seqdesk.com/api/registry",
        registryUrl: "https://seqdesk.com/api/registry",
        browseUrl: "https://seqdesk.com/pipelines",
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
            downloadUrl: "https://seqdesk.com/api/registry/pipelines/mag/3.0.0/download",
          },
        ],
      },
      {
        id: "registry:https://seqdesk.com/api/registry",
        registryUrl: "https://seqdesk.com/api/registry",
        browseUrl: "https://seqdesk.com/pipelines",
        label: "SeqDesk Registry",
      }
    );

    expect(normalized.downloadUrl).toBe(
      "https://seqdesk.com/api/registry/pipelines/mag/3.0.0/download"
    );
    expect(normalized.source.downloadUrl).toBe(
      "https://seqdesk.com/api/registry/pipelines/mag/3.0.0/download"
    );
  });
});
