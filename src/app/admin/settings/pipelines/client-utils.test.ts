import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchJson,
  getApiErrorMessage,
  getGuidedSetupCatalog,
  getNextGuidedSetupItem,
  getPostInstallCatalogView,
  getPrivatePackageUrl,
  isNumericPipelineConfigType,
  parsePipelineConfigInputValue,
  type GuidedSetupReadinessItem,
} from "./client-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pipeline settings client utilities", () => {
  it("parses both number and integer fields as numeric configuration", () => {
    expect(isNumericPipelineConfigType("number")).toBe(true);
    expect(isNumericPipelineConfigType("integer")).toBe(true);
    expect(isNumericPipelineConfigType("string")).toBe(false);
    expect(parsePipelineConfigInputValue("number", "0.5")).toBe(0.5);
    expect(parsePipelineConfigInputValue("integer", "12")).toBe(12);
    expect(parsePipelineConfigInputValue("integer", "")).toBeUndefined();
    expect(parsePipelineConfigInputValue("string", "12")).toBe("12");
  });

  it("returns parsed JSON for a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ pipelines: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    await expect(
      fetchJson<{ pipelines: unknown[] }>("/api/admin/settings/pipelines")
    ).resolves.toEqual({ pipelines: [] });
  });

  it("includes server error details for a non-success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Failed to fetch pipeline configurations",
            details: "Registry connection timed out",
          }),
          {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "content-type": "application/json" },
          }
        )
      )
    );

    await expect(
      fetchJson("/api/admin/settings/pipelines/store")
    ).rejects.toThrow(
      "Failed to fetch pipeline configurations: Registry connection timed out"
    );
  });

  it("reports invalid JSON instead of treating it as empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      )
    );

    await expect(
      fetchJson("/api/admin/settings/pipelines/store")
    ).rejects.toThrow(
      "The server returned invalid JSON for /api/admin/settings/pipelines/store"
    );
  });

  it("combines an API error and its details for mutation failures", () => {
    expect(
      getApiErrorMessage(
        {
          error: "Failed to install pipeline",
          details: "Package descriptor is invalid",
        },
        "Installation failed"
      )
    ).toBe("Failed to install pipeline: Package descriptor is invalid");
  });

  it("shows every descriptor validation detail returned as an array", () => {
    expect(
      getApiErrorMessage(
        {
          error: "Package validation failed",
          details: ["Missing workflow", "Invalid samplesheet source"],
        },
        "Installation failed"
      )
    ).toBe(
      "Package validation failed: Missing workflow; Invalid samplesheet source"
    );
  });

  it("uses a private registry download URL when no package URL override exists", () => {
    expect(
      getPrivatePackageUrl({
        downloadUrl: "https://registry.example/pipeline-package.json",
      })
    ).toBe("https://registry.example/pipeline-package.json");
  });

  it("orders guided configuration, storage/database, runtime, and enable actions", () => {
    const item = (
      id: string,
      action: GuidedSetupReadinessItem["action"],
      status: GuidedSetupReadinessItem["status"] = "missing"
    ): GuidedSetupReadinessItem => ({ id, label: id, action, status });
    const unorderedItems = [
      item("enabled", "enable", "warning"),
      item("runtime", "configure-runtime"),
      item("database", "download-db"),
      item("storage", "configure-storage"),
      item("configuration", "configure"),
    ];

    expect(getNextGuidedSetupItem({ items: unorderedItems })?.id).toBe(
      "configuration"
    );
    expect(
      getNextGuidedSetupItem({
        items: unorderedItems.map((entry) =>
          entry.id === "configuration" ? { ...entry, status: "ready" } : entry
        ),
      })?.id
    ).toBe("storage");
    expect(
      getNextGuidedSetupItem({
        items: unorderedItems.map((entry) =>
          ["configuration", "storage"].includes(entry.id)
            ? { ...entry, status: "ready" }
            : entry
        ),
      })?.id
    ).toBe("database");
    expect(
      getNextGuidedSetupItem({
        items: unorderedItems.map((entry) =>
          ["configuration", "storage", "database"].includes(entry.id)
            ? { ...entry, status: "ready" }
            : entry
        ),
      })?.id
    ).toBe("runtime");
    expect(
      getNextGuidedSetupItem({
        items: unorderedItems.map((entry) =>
          entry.id === "enabled"
            ? entry
            : { ...entry, status: "ready" as const }
        ),
      })?.id
    ).toBe("enabled");
    expect(
      getNextGuidedSetupItem({
        items: unorderedItems.map((entry) => ({
          ...entry,
          status: "ready" as const,
          action: entry.id === "enabled" ? undefined : entry.action,
        })),
      })
    ).toBeNull();
  });

  it("prioritizes blocking runtime warnings over enable and ignores optional warnings", () => {
    expect(
      getNextGuidedSetupItem({
        items: [
          {
            id: "outputs",
            label: "Outputs",
            status: "warning",
            action: "review-outputs",
          },
          {
            id: "enabled",
            label: "Enabled",
            status: "warning",
            action: "enable",
          },
        ],
      })?.id
    ).toBe("enabled");
    expect(
      getNextGuidedSetupItem({
        items: [
          {
            id: "outputs",
            label: "Outputs",
            status: "warning",
            action: "review-outputs",
          },
        ],
      })
    ).toBeNull();
    expect(
      getNextGuidedSetupItem({
        items: [
          {
            id: "runtime-warning",
            label: "Runtime warning",
            status: "warning",
            action: "configure-runtime",
            blocking: true,
          },
          {
            id: "enabled",
            label: "Enabled",
            status: "warning",
            action: "enable",
          },
        ],
      })?.id
    ).toBe("runtime-warning");
  });

  it("selects the supported catalog and the appropriate post-install view", () => {
    expect(getGuidedSetupCatalog(["study"], "order")).toBe("study");
    expect(getGuidedSetupCatalog(["order", "study"], "study")).toBe("study");
    expect(
      getPostInstallCatalogView({
        enabled: false,
        readiness: { status: "warning", canEnable: true },
      })
    ).toBe("needs-setup");
    expect(
      getPostInstallCatalogView({
        enabled: true,
        readiness: { status: "warning", canEnable: true },
      })
    ).toBe("installed");
  });
});
