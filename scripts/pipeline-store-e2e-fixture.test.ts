import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PIPELINE_STORE_FIXTURE_FAULT_FILE,
  PIPELINE_STORE_FIXTURE_FAULT_PHASE,
  PIPELINE_STORE_FIXTURE_ID,
  PIPELINE_STORE_FIXTURE_V1,
  PIPELINE_STORE_FIXTURE_V2,
  PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
  PIPELINE_STORE_FIXTURE_DATABASE_SHA256,
  buildInvalidPipelineStoreUpdate,
  buildValidPipelineStorePackage,
  pipelineStoreFixtureResourceMarker,
  provisionPipelineStoreFixtureResource,
  startPipelineStoreFixture,
} from "./lib/pipeline-store-e2e-fixture.mjs";
import { lintPipelineDescriptor } from "../src/lib/pipelines/descriptor-linter";
import {
  PIPELINE_INSTALL_E2E_FAULT_FILE,
  PIPELINE_INSTALL_E2E_FAULT_ENV,
  PIPELINE_INSTALL_E2E_FAULT_PHASE,
  PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
  installPackageDirectory,
  writePackageFiles,
} from "../src/lib/pipelines/package-install";

const PIPELINE_ID = PIPELINE_STORE_FIXTURE_ID;
const tempDirectories: string[] = [];

async function createPackageDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "seqdesk-store-e2e-fixture-")
  );
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("pipeline store E2E fixture", () => {
  it("ships a valid and locally runnable v1 descriptor package", async () => {
    const packageDirectory = await createPackageDirectory();
    await writePackageFiles(
      packageDirectory,
      buildValidPipelineStorePackage(PIPELINE_ID),
      PIPELINE_ID
    );

    const result = await lintPipelineDescriptor(packageDirectory, PIPELINE_ID);
    const manifest = JSON.parse(
      await fs.readFile(path.join(packageDirectory, "manifest.json"), "utf8")
    );
    const registry = JSON.parse(
      await fs.readFile(path.join(packageDirectory, "registry.json"), "utf8")
    );
    const workflow = await fs.readFile(
      path.join(packageDirectory, "workflow", "main.nf"),
      "utf8"
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(manifest.package.version).toBe(PIPELINE_STORE_FIXTURE_V1);
    expect(manifest.execution.paramMap.fixtureLabel).toBe("--fixture_label");
    expect(
      manifest.execution.paramMap[PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]
    ).toBe("--fixture_database");
    expect(registry.configSchema.required).toEqual(["fixtureLabel"]);
    expect(
      registry.configSchema.properties[
        PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
      ]["x-seqdesk"]
    ).toMatchObject({
      placement: "basic",
      group: "databases",
    });
    expect(workflow).toContain('${params.outdir}/results');
    expect(workflow).toContain("file(params.fixture_database, checkIfExists: true)");
    expect(workflow).toContain('resource_marker="\\$(cat');
    expect(workflow).toContain(
      'test "\\$resource_marker" = \'${fixture_label}\''
    );
    expect(workflow).toContain(
      'printf \'%s\\n\' "\\$resource_marker" > fixture-report.txt'
    );
    await expect(
      fs.access(path.join(packageDirectory, "workflow", "main.nf"))
    ).resolves.toBeUndefined();
  });

  it("creates a bounded local database file and links it for guided setup", async () => {
    const resourceRoot = await createPackageDirectory();
    const resource = provisionPipelineStoreFixtureResource({
      pipelineId: PIPELINE_ID,
      resourceRoot,
    });

    expect(resource).toMatchObject({
      configKey: PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
      marker: pipelineStoreFixtureResourceMarker(PIPELINE_ID),
      linkedBySetup: true,
    });
    expect(path.relative(resourceRoot, resource.linkedPath)).not.toMatch(
      /^\.\.(?:[/\\]|$)/
    );
    expect((await fs.lstat(resource.linkedPath)).isSymbolicLink()).toBe(true);
    await expect(fs.realpath(resource.linkedPath)).resolves.toBe(
      await fs.realpath(resource.sourcePath)
    );
    await expect(fs.readFile(resource.linkedPath, "utf8")).resolves.toBe(
      `${pipelineStoreFixtureResourceMarker(PIPELINE_ID)}\n`
    );
    const fixtureDatabaseSha256 = crypto
      .createHash("sha256")
      .update(await fs.readFile(resource.linkedPath))
      .digest("hex");
    expect(fixtureDatabaseSha256).toBe(
      PIPELINE_STORE_FIXTURE_DATABASE_SHA256
    );
  });

  it("rejects unsafe resource roots instead of writing broadly", () => {
    expect(() =>
      provisionPipelineStoreFixtureResource({
        pipelineId: PIPELINE_ID,
        resourceRoot: "relative/database-root",
      })
    ).toThrow(/must be absolute/);
    expect(() =>
      provisionPipelineStoreFixtureResource({
        pipelineId: PIPELINE_ID,
        resourceRoot: path.parse(process.cwd()).root,
      })
    ).toThrow(/cannot be the filesystem root/);
  });

  it("blocks and explicitly releases the database resource body", async () => {
    const fixture = await startPipelineStoreFixture({
      fixtureUrl: "http://127.0.0.1:0",
      pipelineId: PIPELINE_ID,
      blockResourceDownload: true,
    });

    try {
      expect(new URL(fixture.resourceUrl).port).not.toBe("0");
      const headResponse = await fetch(fixture.resourceUrl, { method: "HEAD" });
      expect(headResponse.ok).toBe(true);
      expect(Number(headResponse.headers.get("content-length"))).toBeGreaterThan(0);

      let bodySettled = false;
      const bodyPromise = fetch(fixture.resourceUrl)
        .then((response) => {
          expect(response.ok).toBe(true);
          return response.text();
        })
        .then((body) => {
          bodySettled = true;
          return body;
        });

      await fixture.waitForResourceDownloadRequest();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(bodySettled).toBe(false);
      expect(fixture.requests).toEqual(
        expect.arrayContaining([
          {
            method: "HEAD",
            path: "/resources/fixture-database.txt",
          },
          {
            method: "GET",
            path: "/resources/fixture-database.txt",
          },
        ])
      );

      fixture.releaseResourceDownload();
      const body = await bodyPromise;
      expect(body).toBe(`${pipelineStoreFixtureResourceMarker(PIPELINE_ID)}\n`);
      expect(
        crypto.createHash("sha256").update(body).digest("hex")
      ).toBe(PIPELINE_STORE_FIXTURE_DATABASE_SHA256);
    } finally {
      await fixture.close();
    }
  });

  it("releases a blocked resource request while closing the fixture", async () => {
    const fixture = await startPipelineStoreFixture({
      fixtureUrl: "http://127.0.0.1:0",
      pipelineId: PIPELINE_ID,
      blockResourceDownload: true,
    });
    const bodyPromise = fetch(fixture.resourceUrl).then((response) =>
      response.text()
    );

    await fixture.waitForResourceDownloadRequest();
    await fixture.close();

    await expect(bodyPromise).resolves.toBe(
      `${pipelineStoreFixtureResourceMarker(PIPELINE_ID)}\n`
    );
  });

  it("ships a descriptor-valid v2 with the exact restore-phase fault marker", async () => {
    const packageDirectory = await createPackageDirectory();
    await writePackageFiles(
      packageDirectory,
      buildInvalidPipelineStoreUpdate(PIPELINE_ID),
      PIPELINE_ID
    );

    const result = await lintPipelineDescriptor(packageDirectory, PIPELINE_ID);
    const manifest = JSON.parse(
      await fs.readFile(path.join(packageDirectory, "manifest.json"), "utf8")
    );

    expect(manifest.package.version).toBe(PIPELINE_STORE_FIXTURE_V2);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(PIPELINE_STORE_FIXTURE_ID).toBe(
      PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID
    );
    expect(PIPELINE_STORE_FIXTURE_FAULT_FILE).toBe(
      PIPELINE_INSTALL_E2E_FAULT_FILE
    );
    expect(PIPELINE_STORE_FIXTURE_FAULT_PHASE).toBe(
      PIPELINE_INSTALL_E2E_FAULT_PHASE
    );
    await expect(
      fs.readFile(
        path.join(packageDirectory, PIPELINE_STORE_FIXTURE_FAULT_FILE),
        "utf8"
      )
    ).resolves.toBe(
      `${JSON.stringify(
        {
          pipelineId: PIPELINE_ID,
          phase: PIPELINE_STORE_FIXTURE_FAULT_PHASE,
        },
        null,
        2
      )}\n`
    );
  });

  it("restores the valid v1 directory after v2 fails in the post-backup swap phase", async () => {
    vi.stubEnv(PIPELINE_INSTALL_E2E_FAULT_ENV, "1");
    const pipelinesDirectory = await createPackageDirectory();
    await installPackageDirectory(
      pipelinesDirectory,
      PIPELINE_ID,
      (stagingDirectory) =>
        writePackageFiles(
          stagingDirectory,
          buildValidPipelineStorePackage(PIPELINE_ID),
          PIPELINE_ID
        ),
      { replaceExisting: false }
    );

    await expect(
      installPackageDirectory(
        pipelinesDirectory,
        PIPELINE_ID,
        (stagingDirectory) =>
          writePackageFiles(
            stagingDirectory,
            buildInvalidPipelineStoreUpdate(PIPELINE_ID),
            PIPELINE_ID
        ),
        { replaceExisting: true }
      )
    ).rejects.toThrow(
      new RegExp(
        `definition\\.pipeline.*${PIPELINE_STORE_FIXTURE_FAULT_PHASE}`
      )
    );

    const installedDirectory = path.join(pipelinesDirectory, PIPELINE_ID);
    const installedManifest = JSON.parse(
      await fs.readFile(
        path.join(installedDirectory, "manifest.json"),
        "utf8"
      )
    );
    const lintResult = await lintPipelineDescriptor(
      installedDirectory,
      PIPELINE_ID
    );

    expect(installedManifest.package.version).toBe(
      PIPELINE_STORE_FIXTURE_V1
    );
    expect(lintResult.valid).toBe(true);
    await expect(
      fs.access(path.join(installedDirectory, "workflow", "main.nf"))
    ).resolves.toBeUndefined();
    await expect(
      fs.readdir(pipelinesDirectory).then((entries) =>
        entries.filter(
          (entry) =>
            entry.startsWith(`${PIPELINE_ID}.__backup-`) ||
            entry.startsWith(`${PIPELINE_ID}.__tmp-`)
        )
      )
    ).resolves.toEqual([]);
  });
});
