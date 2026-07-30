import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIPELINE_PACKAGE_GENERATION_FILE,
  readPipelinePackageGenerationSync,
} from "./package-cache-generation";
import { clearPackageCache, getPackage } from "./package-loader";
import { clearRegistryCache, getPipelineDefinition } from "./registry";
import {
  PIPELINE_INSTALL_CLI_E2E_FAULT_PIPELINE_ID,
  PIPELINE_INSTALL_E2E_FAULT_FILE,
  PIPELINE_INSTALL_E2E_FAULT_ENV,
  PIPELINE_INSTALL_E2E_FAULT_PHASE,
  PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
  PIPELINE_INSTALL_LOCKS_DIR,
  PIPELINE_INSTALL_LOCK_OWNER_FILE,
  PackageInstallLockTimeoutError,
  assertPackageId,
  installPackageDirectory,
  resolveStorePath,
  writePackageFiles,
} from "./package-install";

let tempDir: string;

function validManifest(id: string) {
  return {
    manifestVersion: 1,
    package: {
      id,
      name: `${id} pipeline`,
      version: "1.0.0",
      description: "Test pipeline package",
    },
    files: {
      definition: "definition.json",
      registry: "registry.json",
      samplesheet: "samplesheet.yaml",
    },
    inputs: [],
    execution: {
      type: "nextflow",
      pipeline: `nf-core/${id}`,
      version: "1.0.0",
      profiles: ["conda"],
      defaultParams: {},
    },
    outputs: [],
  };
}

function validDefinition(id: string) {
  return {
    pipeline: id,
    name: `${id} pipeline`,
    description: "Test pipeline package",
    version: "1.0.0",
    steps: [],
    inputs: [],
    outputs: [],
  };
}

function validRegistry(id: string) {
  return {
    id,
    name: `${id} pipeline`,
    description: "Test pipeline package",
    category: "analysis",
    version: "1.0.0",
    requires: {},
    outputs: [],
    visibility: {
      showToUser: true,
      userCanStart: true,
    },
    input: {
      supportedScopes: ["study"],
      perSample: {
        reads: false,
        pairedEnd: false,
      },
    },
    samplesheet: {
      format: "csv",
      generator: "internal",
    },
    configSchema: {
      type: "object",
      properties: {},
    },
    defaultConfig: {},
    icon: "beaker",
  };
}

async function writeValidPackageDirectory(
  packageDir: string,
  id: string,
  marker?: string
): Promise<void> {
  await fs.writeFile(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(validManifest(id))
  );
  await fs.writeFile(
    path.join(packageDir, "definition.json"),
    JSON.stringify(validDefinition(id))
  );
  await fs.writeFile(
    path.join(packageDir, "registry.json"),
    JSON.stringify(validRegistry(id))
  );
  await fs.writeFile(
    path.join(packageDir, "samplesheet.yaml"),
    "samplesheet:\n  format: csv\n  filename: samples.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: sample.sampleId\n"
  );
  if (marker !== undefined) {
    await fs.writeFile(path.join(packageDir, "marker.txt"), marker);
  }
}

async function writeE2EFaultMarker(
  packageDir: string,
  marker: { pipelineId?: string; phase?: string } = {}
): Promise<void> {
  await fs.writeFile(
    path.join(packageDir, PIPELINE_INSTALL_E2E_FAULT_FILE),
    JSON.stringify({
      pipelineId:
        marker.pipelineId ?? PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
      phase: marker.phase ?? PIPELINE_INSTALL_E2E_FAULT_PHASE,
    })
  );
}

function runInstallWorker(
  scriptPath: string,
  moduleUrl: string,
  pipelinesDir: string,
  marker: string,
  eventsPath: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        scriptPath,
        moduleUrl,
        pipelinesDir,
        marker,
        eventsPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Install worker exited with ${code}: ${stderr || stdout}`
          )
        );
      }
    });
  });
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "package-install-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  clearPackageCache();
  clearRegistryCache();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("package install helpers", () => {
  it("accepts package id from stringified manifest payloads", () => {
    expect(() =>
      assertPackageId(
        {
          files: {
            "manifest.json": JSON.stringify({
              package: {
                id: "mag",
              },
            }),
          },
        },
        "mag"
      )
    ).not.toThrow();
  });

  it("rejects mismatched package ids from the payload metadata", () => {
    expect(() =>
      assertPackageId(
        {
          package: {
            id: "other",
          },
        },
        "mag"
      )
    ).toThrow("Package ID mismatch. Expected mag but got other.");
  });

  it("ignores invalid stringified manifests when other payload metadata matches", () => {
    expect(() =>
      assertPackageId(
        {
          id: "mag",
          files: {
            "manifest.json": "{not-json",
          },
        },
        "mag"
      )
    ).not.toThrow();
  });

  it("rejects absolute and traversal store paths", () => {
    expect(() => resolveStorePath(tempDir, "/tmp/outside")).toThrow(
      "Invalid absolute path from store: /tmp/outside"
    );
    expect(() => resolveStorePath(tempDir, "../outside")).toThrow(
      "Invalid path traversal from store: ../outside"
    );
  });

  it("rejects unsafe pipeline IDs before creating a staging directory", () => {
    const writer = vi.fn(async () => {});

    for (const pipelineId of [
      "../outside",
      "custom.__tmp-release",
      "custom.__backup-release",
    ]) {
      expect(() =>
        installPackageDirectory(
          path.join(tempDir, "pipelines"),
          pipelineId,
          writer
        )
      ).toThrow("Invalid pipeline ID");
    }
    expect(writer).not.toHaveBeenCalled();
  });

  it("writes package files from a files map payload", async () => {
    const targetDir = path.join(tempDir, "pkg");
    await writePackageFiles(
      targetDir,
      {
        files: {
          "manifest.json": JSON.stringify({
            package: {
              id: "mag",
            },
          }),
          "definition.json": "{}",
        },
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "definition.json"), "utf8")).resolves.toBe(
      "{}"
    );
  });

  it("writes base64 encoded file arrays from store payloads", async () => {
    const targetDir = path.join(tempDir, "pkg");

    await writePackageFiles(
      targetDir,
      {
        files: [
          {
            path: "manifest.json",
            content: JSON.stringify({
              package: {
                id: "mag",
              },
            }),
          },
          {
            path: "nested/data.txt",
            content: Buffer.from("hello world").toString("base64"),
            encoding: "base64",
          },
        ],
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "nested", "data.txt"), "utf8")).resolves.toBe(
      "hello world"
    );
  });

  it("rejects invalid array file entries from the store", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          files: [{ content: "missing-path" }],
        },
        "mag"
      )
    ).rejects.toThrow("Invalid file entry from store.");
  });

  it("rejects non-string content in file maps", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          files: {
            "manifest.json": JSON.stringify({
              package: {
                id: "mag",
              },
            }),
            "definition.json": 123,
          },
        },
        "mag"
      )
    ).rejects.toThrow("Invalid file content for definition.json");
  });

  it("writes manifest, registry, samplesheet, and parser payloads", async () => {
    const targetDir = path.join(tempDir, "pkg");
    await fs.mkdir(targetDir, { recursive: true });

    await writePackageFiles(
      targetDir,
      {
        manifest: {
          package: {
            id: "mag",
          },
        },
        definition: {
          pipeline: "mag",
        },
        registry: {
          id: "mag",
        },
        samplesheet: "rows: []\n",
        parsers: {
          "parsers/result.js": "export const parse = () => [];\n",
        },
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "manifest.json"), "utf8")).resolves.toContain(
      '"id": "mag"'
    );
    await expect(
      fs.readFile(path.join(targetDir, "samplesheet.yaml"), "utf8")
    ).resolves.toBe("rows: []\n");
    await expect(
      fs.readFile(path.join(targetDir, "parsers", "result.js"), "utf8")
    ).resolves.toBe("export const parse = () => [];\n");
  });

  it("rejects unsupported package payload formats", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          manifest: {
            package: {
              id: "mag",
            },
          },
        },
        "mag"
      )
    ).rejects.toThrow("Unsupported package payload format from store.");
  });

  it("restores the previous install when replacement swap fails", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await fs.writeFile(path.join(stageDir, "manifest.json"), "new");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")).resolves.toBe(
      "old"
    );
  });

  it("returns update and removes the backup after a successful replacement", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    const generationBefore = readPipelinePackageGenerationSync(pipelinesDir);
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    const result = await installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
      await writeValidPackageDirectory(stageDir, "mag", "new");
    });

    expect(result).toBe("update");
    await expect(fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")).resolves.toBe(
      "new"
    );
    await expect(
      fs.readdir(pipelinesDir).then((entries) => entries.filter((entry) => entry.includes("backup")))
    ).resolves.toEqual([]);
    expect(readPipelinePackageGenerationSync(pipelinesDir)).not.toBe(
      generationBefore
    );
  });

  it("restores the previous package when committing cache generation fails", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    const generationBefore = readPipelinePackageGenerationSync(pipelinesDir);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, "mag", "old");

    const actualRename = fs.rename.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (from, to) => {
        if (
          String(to) ===
          path.join(pipelinesDir, PIPELINE_PACKAGE_GENERATION_FILE)
        ) {
          throw new Error("generation marker failed");
        }
        return actualRename(from, to);
      });

    try {
      await expect(
        installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
          await writeValidPackageDirectory(stageDir, "mag", "new");
        })
      ).rejects.toThrow("generation marker failed");
    } finally {
      renameSpy.mockRestore();
    }

    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("old");
    expect(readPipelinePackageGenerationSync(pipelinesDir)).toBe(
      generationBefore
    );
  });

  it("does not replace an installed package when replacement is disabled", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "old");
    const writer = vi.fn();

    await expect(
      installPackageDirectory(pipelinesDir, "mag", writer, {
        replaceExisting: false,
      })
    ).rejects.toThrow("already installed");

    expect(writer).not.toHaveBeenCalled();
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("old");
  });

  it("times out without invoking the writer while another live process owns the lock", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const lockPath = path.join(
      pipelinesDir,
      PIPELINE_INSTALL_LOCKS_DIR,
      "mag.lock"
    );
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(
      path.join(lockPath, PIPELINE_INSTALL_LOCK_OWNER_FILE),
      JSON.stringify({
        token: "live-owner",
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
      })
    );
    const writer = vi.fn(async () => {});

    const install = installPackageDirectory(pipelinesDir, "mag", writer, {
      lockTimeoutMs: 30,
      lockStaleMs: 60_000,
      lockPollIntervalMs: 5,
    });

    await expect(install).rejects.toBeInstanceOf(
      PackageInstallLockTimeoutError
    );
    expect(writer).not.toHaveBeenCalled();
    await expect(fs.access(lockPath)).resolves.toBeUndefined();
  });

  it("recovers an expired lock before installing", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const lockPath = path.join(
      pipelinesDir,
      PIPELINE_INSTALL_LOCKS_DIR,
      "mag.lock"
    );
    await fs.mkdir(lockPath, { recursive: true });
    const oldTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, oldTime, oldTime);

    const result = await installPackageDirectory(
      pipelinesDir,
      "mag",
      async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag", "recovered");
      },
      {
        lockTimeoutMs: 1_000,
        lockStaleMs: 10,
        lockPollIntervalMs: 5,
      }
    );

    expect(result).toBe("install");
    await expect(
      fs.readFile(path.join(pipelinesDir, "mag", "marker.txt"), "utf8")
    ).resolves.toBe("recovered");
    await expect(fs.readdir(path.dirname(lockPath))).resolves.toEqual([]);
  });

  it(
    "serializes two real installer processes without corrupting the destination",
    async () => {
      const pipelinesDir = path.join(tempDir, "pipelines");
      const eventsPath = path.join(tempDir, "install-events.jsonl");
      const workerPath = path.join(tempDir, "install-worker.mjs");
      const packageInstallUrl = pathToFileURL(
        path.join(
          process.cwd(),
          "src",
          "lib",
          "pipelines",
          "package-install.ts"
        )
      ).href;
      await fs.writeFile(
        workerPath,
        `
import fs from "node:fs/promises";
import path from "node:path";

const [moduleUrl, pipelinesDir, marker, eventsPath] = process.argv.slice(2);
const { installPackageDirectory } = await import(moduleUrl);
const pipelineId = "mag";
const appendEvent = (event) =>
  fs.appendFile(eventsPath, JSON.stringify({ event, marker, at: Date.now() }) + "\\n");

const action = await installPackageDirectory(
  pipelinesDir,
  pipelineId,
  async (stageDir) => {
    await appendEvent("start");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(
      path.join(stageDir, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        package: {
          id: pipelineId,
          name: "MAG pipeline",
          version: "1.0.0",
          description: "Cross-process install fixture"
        },
        files: {
          definition: "definition.json",
          registry: "registry.json",
          samplesheet: "samplesheet.yaml"
        },
        inputs: [],
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {}
        },
        outputs: []
      })
    );
    await fs.writeFile(
      path.join(stageDir, "definition.json"),
      JSON.stringify({
        pipeline: pipelineId,
        name: "MAG pipeline",
        description: "Cross-process install fixture",
        version: "1.0.0",
        steps: [],
        inputs: [],
        outputs: []
      })
    );
    await fs.writeFile(
      path.join(stageDir, "registry.json"),
      JSON.stringify({
        id: pipelineId,
        name: "MAG pipeline",
        description: "Cross-process install fixture",
        category: "analysis",
        version: "1.0.0",
        requires: {},
        outputs: [],
        visibility: { showToUser: true, userCanStart: true },
        input: {
          supportedScopes: ["study"],
          perSample: { reads: false, pairedEnd: false }
        },
        samplesheet: { format: "csv", generator: "internal" },
        configSchema: { type: "object", properties: {} },
        defaultConfig: {},
        icon: "beaker"
      })
    );
    await fs.writeFile(
      path.join(stageDir, "samplesheet.yaml"),
      "samplesheet:\\n  format: csv\\n  filename: samples.csv\\n  rows:\\n    scope: sample\\n  columns:\\n    - name: sample\\n      source: sample.sampleId\\n"
    );
    await fs.writeFile(path.join(stageDir, "marker.txt"), marker);
    await appendEvent("end");
  }
);
process.stdout.write(action);
`,
        "utf8"
      );

      const results = await Promise.all([
        runInstallWorker(
          workerPath,
          packageInstallUrl,
          pipelinesDir,
          "first",
          eventsPath
        ),
        runInstallWorker(
          workerPath,
          packageInstallUrl,
          pipelinesDir,
          "second",
          eventsPath
        ),
      ]);

      expect(results.map((result) => result.stdout.trim()).sort()).toEqual([
        "install",
        "update",
      ]);
      const events = (await fs.readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              event: "start" | "end";
              marker: string;
              at: number;
            }
        );
      expect(events.map(({ event }) => event)).toEqual([
        "start",
        "end",
        "start",
        "end",
      ]);
      expect(events[0].marker).toBe(events[1].marker);
      expect(events[2].marker).toBe(events[3].marker);
      expect(events[0].marker).not.toBe(events[2].marker);
      await expect(
        fs.readFile(path.join(pipelinesDir, "mag", "marker.txt"), "utf8")
      ).resolves.toBe(events[2].marker);
      await expect(
        fs.readdir(pipelinesDir).then((entries) =>
          entries.filter(
            (entry) =>
              entry.startsWith("mag.__tmp-") ||
              entry.startsWith("mag.__backup-")
          )
        )
      ).resolves.toEqual([]);
      await expect(
        fs.readFile(
          path.join(pipelinesDir, PIPELINE_PACKAGE_GENERATION_FILE),
          "utf8"
        )
      ).resolves.toMatch(/\S+/);
    },
    15_000
  );

  it("reports a completed update even when stale backup cleanup fails", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    const actualRm = fs.rm.bind(fs);
    const rmSpy = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (String(target).includes("mag.__backup-")) {
        throw new Error("backup cleanup failed");
      }
      return actualRm(target, options);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await installPackageDirectory(
      pipelinesDir,
      "mag",
      async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag", "new");
      }
    );

    rmSpy.mockRestore();
    warnSpy.mockRestore();

    expect(result).toBe("update");
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("new");
    await expect(
      fs.readdir(pipelinesDir).then((entries) =>
        entries.filter((entry) => entry.includes("backup"))
      )
    ).resolves.toHaveLength(1);
  });

  it("keeps the existing package when staged manifest paths escape the package", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");
    await fs.writeFile(
      path.join(pipelinesDir, "outside-definition.json"),
      JSON.stringify(validDefinition("mag"))
    );

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag");
        await fs.writeFile(
          path.join(stageDir, "manifest.json"),
          JSON.stringify({
            ...validManifest("mag"),
            files: {
              ...validManifest("mag").files,
              definition: "../outside-definition.json",
            },
          })
        );
      })
    ).rejects.toThrow(/Invalid pipeline package.*stay inside the package directory/);

    await expect(fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")).resolves.toBe(
      "old"
    );
  });

  it("keeps the existing package when staged runtime descriptors are malformed", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "existing");

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag");
        await fs.writeFile(
          path.join(stageDir, "registry.json"),
          JSON.stringify({
            ...validRegistry("mag"),
            outputs: [null],
          })
        );
      })
    ).rejects.toThrow(/Invalid pipeline package.*registry\.json is invalid/);

    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("existing");
  });

  it("keeps the existing package when a staged local workflow is missing", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "existing");

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag");
        await fs.writeFile(
          path.join(stageDir, "manifest.json"),
          JSON.stringify({
            ...validManifest("mag"),
            execution: {
              ...validManifest("mag").execution,
              pipeline: "./workflow",
            },
          })
        );
      })
    ).rejects.toThrow(/Invalid pipeline package.*does not exist/);

    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("existing");
  });

  it("restores the backup when the staged directory cannot be swapped into place", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    const actualRename = fs.rename.bind(fs);
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error("swap failed");
      }
      return actualRename(from, to);
    });

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writeValidPackageDirectory(stageDir, "mag", "new");
      })
    ).rejects.toThrow("swap failed");

    renameSpy.mockRestore();

    await expect(fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")).resolves.toBe(
      "old"
    );
  });

  it("restores the backup when the explicit Store E2E fixture faults after backup", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");

    const pipelineId = PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID;
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    const actualRename = fs.rename.bind(fs);
    const renameCalls: Array<{ from: string; to: string }> = [];
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (from, to) => {
        renameCalls.push({ from: String(from), to: String(to) });
        return actualRename(from, to);
      });

    try {
      await expect(
        installPackageDirectory(
          pipelinesDir,
          pipelineId,
          async (stageDir) => {
            await writeValidPackageDirectory(stageDir, pipelineId, "v2");
            await writeE2EFaultMarker(stageDir);
          },
          { replaceExisting: true }
        )
      ).rejects.toThrow(
        new RegExp(
          `definition\\.pipeline.*${PIPELINE_INSTALL_E2E_FAULT_PHASE}`
        )
      );
    } finally {
      renameSpy.mockRestore();
    }

    expect(renameCalls).toHaveLength(2);
    expect(renameCalls[0]).toMatchObject({
      from: pipelineDir,
    });
    expect(renameCalls[0].to).toContain(
      `${pipelineId}.__backup-`
    );
    expect(renameCalls[1]).toEqual({
      from: renameCalls[0].to,
      to: pipelineDir,
    });
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v1");
    await expect(
      fs.readdir(pipelinesDir).then((entries) =>
        entries.filter(
          (entry) =>
            entry.startsWith(`${pipelineId}.__backup-`) ||
            entry.startsWith(`${pipelineId}.__tmp-`)
        )
      )
    ).resolves.toEqual([]);
  });

  it("allows the exact Store browser fault through the explicit E2E switch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "false");
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");

    const pipelineId = PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID;
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    await expect(
      installPackageDirectory(
        pipelinesDir,
        pipelineId,
        async (stageDir) => {
          await writeValidPackageDirectory(stageDir, pipelineId, "v2");
          await writeE2EFaultMarker(stageDir);
        },
        { replaceExisting: true }
      )
    ).rejects.toThrow(
      new RegExp(
        `definition\\.pipeline.*${PIPELINE_INSTALL_E2E_FAULT_PHASE}`
      )
    );
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v1");
  });

  it("allows the exact CLI fixture fault through the explicit E2E switch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");

    const pipelineId = PIPELINE_INSTALL_CLI_E2E_FAULT_PIPELINE_ID;
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    await expect(
      installPackageDirectory(
        pipelinesDir,
        pipelineId,
        async (stageDir) => {
          await writeValidPackageDirectory(stageDir, pipelineId, "v2");
          await writeE2EFaultMarker(stageDir, { pipelineId });
        },
        { replaceExisting: true }
      )
    ).rejects.toThrow(
      new RegExp(
        `definition\\.pipeline.*${PIPELINE_INSTALL_E2E_FAULT_PHASE}`
      )
    );
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v1");
  });

  it("keeps the Store fixture fault marker inert when CI is set without the explicit switch", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CI", "true");

    const pipelineId = PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID;
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    const result = await installPackageDirectory(
      pipelinesDir,
      pipelineId,
      async (stageDir) => {
        await writeValidPackageDirectory(stageDir, pipelineId, "v2");
        await writeE2EFaultMarker(stageDir);
      },
      { replaceExisting: true }
    );

    expect(result).toBe("update");
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v2");
  });

  it("requires the exact Store fixture fault phase", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");

    const pipelineId = PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID;
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    const result = await installPackageDirectory(
      pipelinesDir,
      pipelineId,
      async (stageDir) => {
        await writeValidPackageDirectory(stageDir, pipelineId, "v2");
        await writeE2EFaultMarker(stageDir, {
          phase: "before-backup",
        });
      },
      { replaceExisting: true }
    );

    expect(result).toBe("update");
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v2");
  });

  it("requires the exact Store fixture pipeline ID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");

    const pipelineId = "another-store-fixture";
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await writeValidPackageDirectory(pipelineDir, pipelineId, "v1");

    const result = await installPackageDirectory(
      pipelinesDir,
      pipelineId,
      async (stageDir) => {
        await writeValidPackageDirectory(stageDir, pipelineId, "v2");
        await writeE2EFaultMarker(stageDir);
      },
      { replaceExisting: true }
    );

    expect(result).toBe("update");
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("v2");
  });

  it("installs a store payload that package-loader and registry can expose", async () => {
    const previousCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const pipelinesDir = path.join(tempDir, "pipelines");
      // Prime the loader as a long-lived app process before another installer
      // mutates the package directory.
      expect(getPackage("mag")).toBeUndefined();
      const payload = {
        files: {
          "manifest.json": JSON.stringify({
            manifestVersion: 1,
            package: {
              id: "mag",
              name: "nf-core/mag",
              version: "3.0.0",
              description: "Metagenome assembly and binning",
            },
            files: {
              definition: "definition.json",
              registry: "registry.json",
              samplesheet: "samplesheet.yaml",
            },
            inputs: [],
            execution: {
              type: "nextflow",
              pipeline: "nf-core/mag",
              version: "3.0.0",
              profiles: ["conda"],
              defaultParams: {},
              monitoring: {
                weblog: {
                  enabled: true,
                },
              },
              completionDetection: {
                primary: "weblog",
              },
              slurmConfig: {
                headJobResources: {
                  cpus: 2,
                },
              },
            },
            outputs: [],
          }),
          "definition.json": JSON.stringify({
            pipeline: "mag",
            name: "nf-core/mag",
            description: "Metagenome assembly and binning",
            version: "3.0.0",
            steps: [],
            inputs: [],
            outputs: [],
          }),
          "registry.json": JSON.stringify({
            id: "mag",
            name: "MAG Pipeline",
            description: "Metagenome assembly and binning",
            category: "analysis",
            version: "3.0.0",
            requires: {
              reads: true,
              assemblies: false,
              bins: false,
              checksums: false,
              studyAccession: false,
              sampleMetadata: false,
            },
            outputs: [],
            visibility: {
              showToUser: true,
              userCanStart: false,
            },
            input: {
              supportedScopes: ["study"],
              minSamples: 1,
              perSample: {
                reads: true,
                pairedEnd: true,
              },
            },
            samplesheet: {
              format: "csv",
              generator: "samplesheet.yaml",
            },
            configSchema: {
              type: "object",
              properties: {},
            },
            defaultConfig: {},
            icon: "dna",
          }),
          "samplesheet.yaml": "samplesheet:\n  format: csv\n  filename: mag.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: sample.sampleId\n",
        },
      };

      await installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writePackageFiles(stageDir, payload, "mag");
      });

      const pkg = getPackage("mag");
      const registryDefinition = getPipelineDefinition("mag");

      expect(pkg?.manifest.package.id).toBe("mag");
      expect(registryDefinition?.id).toBe("mag");
      expect(registryDefinition?.name).toBe("MAG Pipeline");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
