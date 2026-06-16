import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    // Forms target (F11/F13): once the importer consumes settings.json.forms the
    // order form lands in a dedicated OrderFormConfig row (the same sink the
    // installer's applyOrderForm writes). Stubbed so the unified behavior has
    // somewhere to land; harmless today because the route never touches it.
    orderFormConfig: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
  },
}));

// Wrap the REAL secret-store so encryptSecret keeps producing genuine enc:v1
// ciphertext (the format the readers decrypt) while letting us assert it is NOT
// invoked on the side-effect-free dry-run preview (audit A15).
const encryptSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/security/secret-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/security/secret-store")
  >("@/lib/security/secret-store");
  encryptSpy.mockImplementation(actual.encryptSecret);
  return { ...actual, encryptSecret: encryptSpy };
});

import { POST } from "./route";
import { decryptSecret, isEncrypted } from "@/lib/security/secret-store";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-infrastructure-import";

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost:3000/api/admin/infrastructure/import",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/infrastructure/import", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-bind the spy to the real encryptSecret after clearAllMocks wiped it.
    const actual = await vi.importActual<
      typeof import("@/lib/security/secret-store")
    >("@/lib/security/secret-store");
    encryptSpy.mockImplementation(actual.encryptSecret);
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/seq",
      extraSettings: JSON.stringify({}),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue(undefined);
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.orderFormConfig.findFirst.mockResolvedValue(null);
    mocks.db.orderFormConfig.upsert.mockResolvedValue(undefined);
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("imports infrastructure settings successfully", async () => {
    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/data/sequencing",
          pipelineRunDir: "/data/runs",
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.applied.dataBasePath).toBe("/data/sequencing");
    expect(body.applied.pipelineRunDir).toBe("/data/runs");
    expect(body.applied.condaPath).toBe("/opt/conda");
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("supports dry run mode", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          sequencingDataDir: "/data/sequencing",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("valid");
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ config: { pipelineRunDir: "/data/runs" } })
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(
      makeRequest({ config: { pipelineRunDir: "/data/runs" } })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when config is not an object", async () => {
    const response = await POST(
      makeRequest({
        config: "not-an-object",
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("JSON object");
  });

  it("returns 400 when no supported settings are found", async () => {
    const response = await POST(
      makeRequest({
        config: {
          unsupportedKey: "value",
        },
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No supported settings");
  });

  it("parses nested execution settings from pipelines.execution structure", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            execution: {
              mode: "slurm",
              slurmQueue: "gpu",
              slurmCores: 8,
              slurmMemory: "64GB",
              slurmTimeLimit: 12,
              slurmOptions: "--gres=gpu:1",
              condaPath: "/opt/miniconda",
              condaEnv: "seqdesk",
              nextflowProfile: "test",
              weblogUrl: "http://localhost:3000/api/weblog",
              weblogSecret: "s3cret",
              runDirectory: "/data/pipeline-runs",
              slurm: {
                enabled: true,
              },
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(true);
    expect(body.applied.slurmQueue).toBe("gpu");
    expect(body.applied.slurmCores).toBe(8);
    expect(body.applied.slurmMemory).toBe("64GB");
    expect(body.applied.condaPath).toBe("/opt/miniconda");
    expect(body.applied.pipelineRunDir).toBe("/data/pipeline-runs");
    expect(body.applied.nextflowProfile).toBe("test");
    expect(body.applied.weblogUrl).toBe("http://localhost:3000/api/weblog");
    expect(body.applied.weblogSecret).toBe("s3cret");
  });

  it("handles execution mode 'local' to disable slurm", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            execution: {
              mode: "local",
              condaPath: "/opt/conda",
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(false);
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("imports per-pipeline execution overrides from hosted profile JSON", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            execution: {
              mode: "local",
              pipelineOverrides: {
                mag: {
                  mode: "slurm",
                  slurm: {
                    queue: "bigmem",
                    cores: "24",
                    memory: "256GB",
                    timeLimit: 48,
                    options: "--account=seqdesk",
                  },
                  nextflowProfile: "slurm",
                },
              },
            },
            metaxpath: {
              runtime: {
                mode: "slurm",
                slurmQueue: "long",
                slurmCores: 12,
              },
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.pipelineOverrides).toEqual({
      mag: {
        mode: "slurm",
        slurm: {
          queue: "bigmem",
          cores: 24,
          memory: "256GB",
          timeLimit: 48,
          options: "--account=seqdesk",
        },
        nextflowProfile: "slurm",
      },
      metaxpath: {
        mode: "slurm",
        slurm: {
          queue: "long",
          cores: 12,
        },
      },
    });

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);
    expect(extraSettings.pipelineExecution.pipelineOverrides.mag.mode).toBe("slurm");
    expect(extraSettings.pipelineExecution.pipelineOverrides.metaxpath.slurm.queue).toBe("long");
  });

  // Finding #9 (review): the WEB profile JSON carries a full `pipelines` block that the
  // install-time apply-core consumes (enable -> installProfilePipelineAllowlist,
  // databaseDirectory -> pipelineExecution.pipelineDatabaseDir), but the in-app importer
  // silently drops it. Two consumers of the SAME file produce divergent runtime state.
  it("applies the pipeline allowlist + database directory the installer reads from the WEB profile JSON", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelines: {
            enabled: true,
            enable: ["simulate-reads", "fastqc", "fastq-checksum", "metaxpath"],
            databaseDirectory: "/net/broker/checkm_refdata/metaxpath_db",
            execution: { mode: "slurm", runDirectory: "/net/broker/devphil/pipeline" },
            configs: { metaxpath: { metaxProfileMemory: "64 GB" } },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);

    // FAILS today: importer never reads pipelines.enable -> installProfilePipelineAllowlist
    // (the key the installer writes at apply-core.mjs:1019).
    expect(extraSettings.installProfilePipelineAllowlist).toEqual([
      "simulate-reads",
      "fastqc",
      "fastq-checksum",
      "metaxpath",
    ]);
    // FAILS today: importer never reads pipelines.databaseDirectory.
    expect(extraSettings.pipelineExecution?.pipelineDatabaseDir).toBe(
      "/net/broker/checkm_refdata/metaxpath_db"
    );
  });

  it("dry run with port includes warning about restart", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toContain("settings.json");
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("warns that form settings are not applied by infrastructure import", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          sequencingDataDir: "/data/sequencing",
          forms: {
            orderFormSettings: "/opt/seqdesk/order-form.json",
            studyFormSettings: "/opt/seqdesk/study-form.json",
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.applied.dataBasePath).toBe("/data/sequencing");
    expect(
      body.warnings.some((warning: string) =>
        warning.includes("not imported here")
      )
    ).toBe(true);
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("returns a targeted error when only form settings are provided", async () => {
    const response = await POST(
      makeRequest({
        config: {
          orderFormSettings: "/opt/seqdesk/order-form.json",
          studyFormSettings: "/opt/seqdesk/study-form.json",
        },
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("settings.json");
  });

  it("merges with existing extraSettings from database", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/old/data",
      extraSettings: JSON.stringify({
        pipelineExecution: {
          useSlurm: true,
          slurmQueue: "old-queue",
        },
        otherSetting: "keep-me",
      }),
    });

    const response = await POST(
      makeRequest({
        config: {
          condaPath: "/new/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);
    expect(extraSettings.otherSetting).toBe("keep-me");
    expect(extraSettings.pipelineExecution.condaPath).toBe("/new/conda");
  });

  it("handles malformed extraSettings JSON gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data",
      extraSettings: "not-valid-json",
    });

    const response = await POST(
      makeRequest({
        config: {
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("resets pipelineRunDir to default when set to '/'", async () => {
    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // When pipelineRunDir is "/", it falls back to default
    expect(body.applied.pipelineRunDir).toBeDefined();
    expect(body.applied.pipelineRunDir).not.toBe("/");
  });

  it("updates existing config file port and nextAuthUrl", async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        app: { port: 3000 },
        runtime: { nextAuthUrl: "http://localhost:3000" },
      })
    );

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 5000,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(writtenContent.app.port).toBe(5000);
    expect(writtenContent.runtime.nextAuthUrl).toContain("5000");
  });

  it("handles port config file write failure gracefully", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockRejectedValue(new Error("EPERM: permission denied"));

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings.some((w: string) => w.includes("Could not update"))).toBe(true);
  });

  it("creates siteSettings when none exist", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/new/data",
        },
      })
    );

    expect(response.status).toBe(200);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.create.dataBasePath).toBe("/new/data");
  });

  it("parses boolean values from string representations", async () => {
    const response = await POST(
      makeRequest({
        config: {
          useSlurm: "yes",
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.useSlurm).toBe(true);
  });

  it("ignores non-positive port and slurmCores values", async () => {
    const response = await POST(
      makeRequest({
        config: {
          port: -1,
          slurmCores: 0,
          condaPath: "/opt/conda",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.port).toBeUndefined();
    expect(body.applied.slurmCores).toBeUndefined();
    expect(body.applied.condaPath).toBe("/opt/conda");
  });

  it("handles port config with config file update", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.writeFile.mockResolvedValue(undefined);

    const response = await POST(
      makeRequest({
        config: {
          pipelineRunDir: "/data/runs",
          port: 4000,
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.port).toBe(4000);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  // Finding F10: posting a full WEB profile export (dev.json top-level keys +
  // the flat public/infrastructure-setup.json secret/bootstrap blocks) must NOT
  // silently swallow the non-infra blocks. Minimum contract: every block the
  // importer does not persist must be SURFACED — either applied or warned about.
  // Today only `forms` warns; with no `forms` key present, warnings is empty and
  // applied carries only the infra fields, so every other block is swallowed.
  it("does not silently drop the non-infrastructure blocks of a full WEB profile export", async () => {
    const fullProfile = {
      // --- infrastructure (the ONLY part this endpoint is scoped to today) ---
      sequencingDataDir: "/data/seq",
      pipelineRunDir: "/data/runs",
      condaPath: "/opt/conda",
      // --- blocks the installer (apply-core) consumes but the importer ignores ---
      access: { departmentSharing: true, allowDeleteSubmittedOrders: true },
      auth: { allowRegistration: false, requireEmailVerification: true },
      ena: { enabled: true, testMode: true, webinUsername: "Webin-1" },
      telemetry: { enabled: true },
      notifications: { inApp: { enabled: false } },
      moduleSettings: {
        "account-validation": { allowedDomains: ["example.org"] },
      },
      modules: { "account-validation": true, "billing-info": true },
      sequencingFiles: { allowedExtensions: [".fastq.gz"], scanDepth: 4 },
      sequencingTech: { platforms: ["ONT"] },
      // --- secret/bootstrap blocks present in the flat infrastructure-setup.json ---
      nextAuthSecret: "shh",
      anthropicApiKey: "sk-ant-xxx",
      adminSecret: "admin-shh",
      databaseUrl: "postgresql://u:p@db/seqdesk",
      directUrl: "postgresql://u:p@db/seqdesk",
      bootstrap: { adminEmail: "admin@example.org" },
      site: { name: "HZI", contactEmail: "ops@example.org" },
    };

    const response = await POST(
      makeRequest({ dryRun: true, config: fullProfile })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    const droppedBlocks = [
      "access",
      "auth",
      "ena",
      "telemetry",
      "notifications",
      "moduleSettings",
      "modules",
      "sequencingFiles",
      "sequencingTech",
      "nextAuthSecret",
      "anthropicApiKey",
      "adminSecret",
      "databaseUrl",
      "directUrl",
      "bootstrap",
      "site",
    ];
    const surfaced = (name: string) =>
      Object.prototype.hasOwnProperty.call(body.applied ?? {}, name) ||
      (body.warnings ?? []).some((w: string) =>
        w.toLowerCase().includes(name.toLowerCase())
      );

    const swallowed = droppedBlocks.filter((b) => !surfaced(b));
    // FAILS today: warnings = [] (no forms key) and applied = {dataBasePath,
    // pipelineRunDir, condaPath}, so `swallowed` is the full list above.
    expect(swallowed).toEqual([]);
  });

  // Finding F11 + F13 (consolidated): a combined settings.json carrying BOTH an
  // infrastructure key AND a populated, canonical `forms.order` {groups,fields}
  // object (the shape the installer's readFormConfig consumes from twincore.json)
  // must round-trip — the importer must PERSIST the order-form definition (either
  // a db.orderFormConfig.upsert call, or the order form embedded into the
  // siteSettings upsert's extraSettings). Today parseImportValues never reads
  // root.forms; it only detects + warns, so nothing durable is written.
  it("round-trips a combined settings.json: a populated forms.order block is applied, not dropped", async () => {
    const formsOrder = {
      groups: [
        { id: "group_sequencing", name: "Sequencing Information", order: 1 },
      ],
      fields: [
        {
          id: "field_ont_run_type",
          type: "select",
          label: "Run Type",
          name: "run_type",
          order: 10,
          groupId: "group_sequencing",
        },
      ],
    };

    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/data/sequencing", // infra key -> applies today
          forms: { order: formsOrder }, // forms key -> dropped today
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.applied.dataBasePath).toBe("/data/sequencing");

    // THE UNIFICATION ASSERTION (fails today): the importer must persist the
    // order-form definition somewhere durable so the single settings.json
    // round-trips. Today nothing writes forms.order to the DB.
    const persistedOrderFormFields = (() => {
      // path A: dedicated OrderFormConfig table (matches installer apply-core)
      const ofCall = mocks.db.orderFormConfig.upsert.mock.calls[0]?.[0];
      if (ofCall) {
        const schema =
          typeof ofCall.update?.schema === "string"
            ? JSON.parse(ofCall.update.schema)
            : ofCall.update?.schema ?? ofCall.create?.schema;
        return typeof schema === "string"
          ? JSON.parse(schema).fields
          : schema?.fields;
      }
      // path B: embedded into siteSettings.extraSettings
      const ssCall = mocks.db.siteSettings.upsert.mock.calls[0]?.[0];
      const extra = ssCall ? JSON.parse(ssCall.update.extraSettings) : {};
      return extra?.forms?.order?.fields ?? extra?.orderFormFields;
    })();

    expect(persistedOrderFormFields).toBeDefined();
    expect(persistedOrderFormFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "run_type" })])
    );
    // And it must NOT just hand-wave with the "not imported here" warning.
    expect(
      (body.warnings ?? []).some((w: string) => w.includes("not imported here"))
    ).toBe(false);
  });

  // Finding F16: a real WEB infrastructure-setup.json carrying top-level
  // access/ena/notifications/telemetry blocks must persist those into the SAME
  // SiteSettings.extraSettings store the per-section settings UI writes
  // (extraSettings.departmentSharing / .notifications / .telemetry / .ena.*).
  // Today the importer reads only pipeline/data-path keys, so none survive.
  it("persists access/ena/notifications/telemetry from a WEB infrastructure-setup.json into the same extraSettings store the per-section UI writes", async () => {
    const response = await POST(
      makeRequest({
        config: {
          sequencingDataDir: "/data/sequencing",
          access: {
            departmentSharing: false,
            allowDeleteSubmittedOrders: true,
            allowUserAssemblyDownload: true,
            orderNotesEnabled: true,
          },
          ena: {
            testMode: true,
            username: "Webin-12345",
            centerName: "Example Center",
            brokerAccount: false,
          },
          notifications: { enabled: true },
          telemetry: { enabled: false },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);

    // The EXACT keys /api/admin/settings/access, notifications, telemetry, ena
    // write to extraSettings. FAILS today: the importer copies none of them.
    expect(extraSettings.departmentSharing).toBe(false);
    expect(extraSettings.allowDeleteSubmittedOrders).toBe(true);
    expect(extraSettings.allowUserAssemblyDownload).toBe(true);
    expect(extraSettings.orderNotesEnabled).toBe(true);
    expect(extraSettings.notifications?.enabled).toBe(true);
    expect(extraSettings.telemetry?.enabled).toBe(false);
    expect(extraSettings.ena?.centerName).toBe("Example Center");
  });

  it("imports ENA credentials from Webin alias fields into the settings columns", async () => {
    const response = await POST(
      makeRequest({
        config: {
          ena: {
            testMode: false,
            webinUsername: " Webin-54321 ",
            webinPassword: " profile-secret ",
            centerName: " Example Center ",
            brokerAccount: true,
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied.ena).toEqual({
      testMode: false,
      username: "Webin-54321",
      password: "***",
      centerName: "Example Center",
      brokerAccount: true,
    });

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.update.enaTestMode).toBe(false);
    expect(upsertCall.update.enaUsername).toBe("Webin-54321");
    expect(isEncrypted(upsertCall.update.enaPassword)).toBe(true);
    expect(decryptSecret(upsertCall.update.enaPassword)).toBe("profile-secret");
    const extraSettings = JSON.parse(upsertCall.update.extraSettings);
    expect(extraSettings.ena).toEqual({
      centerName: "Example Center",
      brokerAccount: true,
    });
  });

  // Audit A15: a dry-run preview must be fully side-effect-free for secrets. It must
  // NOT call encryptSecret (which throws when key material is absent), must NOT 500/
  // error, and must surface only a masked marker for the password.
  it("dry-run carrying ena.password does not 500 and does not call encryptSecret", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: {
          ena: {
            testMode: false,
            username: "Webin-99999",
            password: "preview-secret",
            centerName: "Preview Center",
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // The preview surfaces only a masked marker, never ciphertext or plaintext.
    expect(body.applied.ena.password).toBe("***");
    expect(body.applied.ena.username).toBe("Webin-99999");
    // The side-effect-free contract: no encryption is performed on a preview.
    expect(encryptSpy).not.toHaveBeenCalled();
    // And nothing is persisted.
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  // A real import must persist enaUsername + an ENCRYPTED enaPassword (the enc:v1
  // format the readers decrypt) + extraSettings.ena.centerName — so the imported
  // credentials actually work at submission time.
  it("real import persists enaUsername + a non-plaintext enaPassword + extraSettings.ena.centerName", async () => {
    const response = await POST(
      makeRequest({
        config: {
          ena: {
            testMode: false,
            username: "Webin-77777",
            password: "real-import-secret",
            centerName: "Real Center",
          },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(encryptSpy).toHaveBeenCalled();
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertCall.update.enaUsername).toBe("Webin-77777");
    // Stored value must NOT equal the input plaintext, must be genuine ciphertext,
    // and must decrypt back to the original (matching the settings/ena writer +
    // the submg-runner / submissions / ena-test / database-merge readers).
    expect(upsertCall.update.enaPassword).not.toBe("real-import-secret");
    expect(isEncrypted(upsertCall.update.enaPassword)).toBe(true);
    expect(decryptSecret(upsertCall.update.enaPassword)).toBe(
      "real-import-secret"
    );

    const extraSettings = JSON.parse(upsertCall.update.extraSettings);
    expect(extraSettings.ena.centerName).toBe("Real Center");
  });

  // Finding F12: the importer must NOT resolve weblog settings from the phantom
  // keys runtime.weblogUrl / runtime.weblogSecret — no producer in either repo
  // emits them (real producers are flat nextflowWeblogUrl and nested
  // pipelines.execution.weblog*). A config whose ONLY weblog-bearing keys live
  // under a top-level `runtime` block must NOT have them picked up. FAILS today:
  // firstDefined(..., runtime?.weblogUrl) / (..., runtime?.weblogSecret) at
  // route.ts:333,337 resolve them straight through into `applied`.
  it("ignores phantom runtime.weblogUrl/weblogSecret keys no producer emits (single canonical contract)", async () => {
    const response = await POST(
      makeRequest({
        config: {
          // a real infra key so we get a 200 (not "No supported settings")
          condaPath: "/opt/conda",
          runtime: {
            weblogUrl: "http://phantom.invalid/api/weblog",
            weblogSecret: "phantom-secret",
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // FAILS today: the phantom runtime.* values are resolved and surfaced.
    expect(body.applied.weblogUrl).toBeUndefined();
    expect(body.applied.weblogSecret).toBeUndefined();
  });

  // Finding F21: the importer's user-facing strings must speak ONE shared name
  // "settings.json". (a) the form-only-payload 400 error must mention
  // "settings.json" and NOT "form setup, not infrastructure setup"; (b) the
  // port-restart warning must mention "settings.json" and NOT "seqdesk.config.json".
  // NOTE: existing tests at route.test.ts ~:320 ("seqdesk.config.json") and
  // ~:362 ("form setup") lock in the legacy names and must be flipped post-fix.
  it("names the single document settings.json in the form-only error (not 'form setup, not infrastructure setup')", async () => {
    const response = await POST(
      makeRequest({
        config: {
          orderFormSettings: "/opt/seqdesk/order-form.json",
          studyFormSettings: "/opt/seqdesk/study-form.json",
        },
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    // FAILS today: route.ts:355 says "form setup, not infrastructure setup".
    expect(body.error).toContain("settings.json");
    expect(body.error).not.toMatch(/form setup, not infrastructure setup/i);
  });

  it("references settings.json (not seqdesk.config.json) in the port-restart warning", async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
        config: { pipelineRunDir: "/data/runs", port: 4000 },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const text = (body.warnings ?? []).join(" ");
    // FAILS today: route.ts:524 warning mentions "seqdesk.config.json".
    expect(text).toContain("settings.json");
    expect(text).not.toContain("seqdesk.config.json");
  });
});
