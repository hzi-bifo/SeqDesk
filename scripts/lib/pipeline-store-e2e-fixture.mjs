import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const PIPELINE_STORE_FIXTURE_V1 = "1.0.0";
export const PIPELINE_STORE_FIXTURE_V2 = "2.0.0";
export const PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY = "fixtureDatabase";
export const PIPELINE_STORE_FIXTURE_DATABASE_ID = "fixture-database";
export const PIPELINE_STORE_FIXTURE_DATABASE_FILE_NAME =
  "fixture-database.txt";
export const PIPELINE_STORE_FIXTURE_DATABASE_PATH =
  `/resources/${PIPELINE_STORE_FIXTURE_DATABASE_FILE_NAME}`;
export const PIPELINE_STORE_FIXTURE_DATABASE_SHA256 =
  "475198e07d34d6288f9d3e4c332a63e77fa1b701bc034a8698a932f0a027060f";
export const PIPELINE_STORE_FIXTURE_ID = "seqdesk-store-e2e-fixture";
export const PIPELINE_CLI_E2E_FIXTURE_ID = "seqdesk-cli-e2e-fixture";
export const PIPELINE_STORE_FIXTURE_FAULT_PHASE =
  "after-backup-before-activate";
export const PIPELINE_STORE_FIXTURE_FAULT_FILE =
  ".seqdesk-ci-install-fault.json";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function pipelineStoreFixtureResourceMarker(pipelineId) {
  return `configured-${pipelineId}`;
}

export function provisionPipelineStoreFixtureResource({
  pipelineId,
  resourceRoot,
}) {
  if (typeof resourceRoot !== "string" || !path.isAbsolute(resourceRoot)) {
    throw new Error("Pipeline Store fixture resource root must be absolute.");
  }
  const resolvedRoot = path.resolve(resourceRoot);
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error(
      "Pipeline Store fixture resource root cannot be the filesystem root."
    );
  }

  const safePipelineId = String(pipelineId || "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 80);
  if (!safePipelineId) {
    throw new Error("Pipeline Store fixture requires a non-empty pipeline ID.");
  }

  fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  const resourceDirectory = fs.mkdtempSync(
    path.join(resolvedRoot, `${safePipelineId}-`)
  );
  const sourcePath = path.join(
    resourceDirectory,
    "fixture-database.source.txt"
  );
  const linkedPath = path.join(resourceDirectory, "fixture-database.txt");
  const marker = pipelineStoreFixtureResourceMarker(pipelineId);

  fs.writeFileSync(sourcePath, `${marker}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.symlinkSync(path.basename(sourcePath), linkedPath, "file");

  const linkedStats = fs.lstatSync(linkedPath);
  const resolvedLinkedPath = fs.realpathSync.native(linkedPath);
  const linkedContent = fs.readFileSync(linkedPath, "utf8").trim();
  if (
    !linkedStats.isSymbolicLink() ||
    resolvedLinkedPath !== fs.realpathSync.native(sourcePath) ||
    linkedContent !== marker
  ) {
    throw new Error(
      "Pipeline Store fixture resource link did not preserve the expected content."
    );
  }

  return {
    configKey: PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
    marker,
    resourceDirectory,
    sourcePath,
    linkedPath,
    resolvedLinkedPath,
    linkedBySetup: true,
  };
}

function buildManifest(pipelineId, version) {
  return {
    manifestVersion: 1,
    package: {
      id: pipelineId,
      name: "SeqDesk Store E2E Fixture",
      version,
      description:
        "A deterministic local package used to verify the SeqDesk pipeline store.",
      provider: "SeqDesk CI",
    },
    files: {
      definition: "definition.json",
      registry: "registry.json",
      samplesheet: "samplesheet.yaml",
    },
    targets: {
      supported: ["order"],
    },
    inputs: [],
    execution: {
      type: "nextflow",
      pipeline: "./workflow/main.nf",
      version,
      profiles: ["conda"],
      defaultParams: {},
      paramMap: {
        fixtureLabel: "--fixture_label",
        [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: "--fixture_database",
      },
    },
    outputs: [
      {
        id: "fixture_report",
        scope: "run",
        destination: "run_artifact",
        type: "report",
        fromStep: "fixture",
        discovery: {
          pattern: "results/fixture-report.txt",
        },
      },
    ],
    schema_requirements: {
      tables: ["PipelineRun", "PipelineArtifact"],
    },
  };
}

function buildRegistry(pipelineId, version) {
  return {
    id: pipelineId,
    name: "SeqDesk Store E2E Fixture",
    description:
      "A deterministic local package used to verify install, readiness, activation, and rollback.",
    category: "qc",
    version,
    sortOrder: 9999,
    requires: {
      reads: false,
      assemblies: false,
      bins: false,
      checksums: false,
      studyAccession: false,
      sampleMetadata: false,
    },
    outputs: [
      {
        type: "report",
        name: "fixture_report",
        description: "Deterministic fixture report",
        visibility: "admin",
        downloadable: true,
      },
    ],
    visibility: {
      showToUser: false,
      userCanStart: false,
    },
    input: {
      supportedScopes: ["order"],
      minSamples: 1,
      perSample: {
        reads: false,
        pairedEnd: false,
      },
    },
    samplesheet: {
      format: "csv",
      generator: "samplesheet.yaml",
    },
    configSchema: {
      type: "object",
      properties: {
        fixtureLabel: {
          type: "string",
          title: "Fixture label",
          description:
            "Required marker proving that configuration was persisted before activation.",
          default: "",
        },
        [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: {
          type: "string",
          title: "Fixture database",
          description:
            "Absolute path to the small local resource consumed by this fixture.",
          default: "",
          "x-seqdesk": {
            placement: "basic",
            group: "databases",
            helpText:
              "Required. The guided setup links this hermetic resource before activation.",
          },
        },
      },
      required: [
        "fixtureLabel",
      ],
    },
    defaultConfig: {
      fixtureLabel: "",
      [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: "",
    },
    icon: "FlaskConical",
  };
}

function buildDefinition(pipelineId, version) {
  return {
    pipeline: pipelineId,
    name: "SeqDesk Store E2E Fixture",
    description:
      "Generate one deterministic report to validate the pipeline package contract.",
    version,
    inputs: [],
    outputs: [
      {
        id: "fixture_report",
        name: "Fixture report",
        description: "A deterministic text report",
        fromStep: "fixture",
        fileTypes: [".txt"],
        destination: "run_artifact",
        destinationDescription: "Stored as a run artifact",
      },
    ],
    steps: [
      {
        id: "fixture",
        name: "Create fixture report",
        description: "Write a deterministic report without external services",
        category: "reporting",
        dependsOn: [],
        processMatchers: ["CREATE_FIXTURE_REPORT"],
        tools: ["cat", "printf"],
        outputs: ["fixture-report"],
      },
    ],
  };
}

const SAMPLESHEET = `samplesheet:
  format: csv
  filename: samplesheet.csv
  rows:
    scope: sample
  columns:
    - name: sample_id
      source: sample.sampleId
      required: true
`;

const WORKFLOW = `nextflow.enable.dsl=2

params.fixture_label = "missing-fixture-label"
params.fixture_database = null
params.outdir = "output"

process CREATE_FIXTURE_REPORT {
    publishDir "\${params.outdir}/results", mode: "copy"

    input:
    val fixture_label
    path fixture_database

    output:
    path "fixture-report.txt"

    script:
    """
    resource_marker="\\$(cat '\${fixture_database}')"
    test "\\$resource_marker" = '\${fixture_label}'
    printf '%s\\n' "\\$resource_marker" > fixture-report.txt
    """
}

workflow {
    CREATE_FIXTURE_REPORT(
        params.fixture_label,
        file(params.fixture_database, checkIfExists: true)
    )
}
`;

export function buildValidPipelineStorePackage(pipelineId) {
  return {
    id: pipelineId,
    files: {
      "manifest.json": jsonFile(
        buildManifest(pipelineId, PIPELINE_STORE_FIXTURE_V1)
      ),
      "registry.json": jsonFile(
        buildRegistry(pipelineId, PIPELINE_STORE_FIXTURE_V1)
      ),
      "definition.json": jsonFile(
        buildDefinition(pipelineId, PIPELINE_STORE_FIXTURE_V1)
      ),
      "samplesheet.yaml": SAMPLESHEET,
      "workflow/main.nf": WORKFLOW,
    },
  };
}

/**
 * Build a descriptor-valid newer package with a narrowly scoped CI fault
 * marker. The installer recognizes this marker only for the fixed Store E2E
 * pipeline ID, and only after the current package has moved to its recovery
 * backup. This deterministically exercises the real restore branch without a
 * filesystem race or a simulated external service.
 */
export function buildInvalidPipelineStoreUpdate(pipelineId) {
  return {
    id: pipelineId,
    files: {
      "manifest.json": jsonFile(
        buildManifest(pipelineId, PIPELINE_STORE_FIXTURE_V2)
      ),
      "registry.json": jsonFile(
        buildRegistry(pipelineId, PIPELINE_STORE_FIXTURE_V2)
      ),
      "definition.json": jsonFile(
        buildDefinition(pipelineId, PIPELINE_STORE_FIXTURE_V2)
      ),
      "samplesheet.yaml": SAMPLESHEET,
      "workflow/main.nf": WORKFLOW,
      [PIPELINE_STORE_FIXTURE_FAULT_FILE]: jsonFile({
        pipelineId,
        phase: PIPELINE_STORE_FIXTURE_FAULT_PHASE,
      }),
    },
  };
}

function writeJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function writeTextHeaders(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
}

function writeText(response, status, body, { headOnly = false } = {}) {
  writeTextHeaders(response, status, body);
  response.end(headOnly ? undefined : body);
}

function normalizeFixtureUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:") {
    throw new Error("Pipeline store fixture URL must use http://.");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `Pipeline store fixture must bind to loopback, not ${url.hostname}.`
    );
  }
  if (!url.port) {
    throw new Error("Pipeline store fixture URL must include an explicit port.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "Pipeline store fixture URL must be an origin without a path, query, or hash."
    );
  }
  return url;
}

export async function startPipelineStoreFixture({
  fixtureUrl,
  pipelineId,
  blockResourceDownload = false,
}) {
  const baseUrl = normalizeFixtureUrl(fixtureUrl);
  const validPackage = buildValidPipelineStorePackage(pipelineId);
  const invalidUpdate = buildInvalidPipelineStoreUpdate(pipelineId);
  const requests = [];
  let advertisedVersion = PIPELINE_STORE_FIXTURE_V1;

  const v1Path = `/packages/${encodeURIComponent(pipelineId)}/${PIPELINE_STORE_FIXTURE_V1}.json`;
  const v2Path = `/packages/${encodeURIComponent(pipelineId)}/${PIPELINE_STORE_FIXTURE_V2}.json`;
  let v1Url;
  let v2Url;
  let registryUrl;
  let resourceUrl;
  const resourceBody = `${pipelineStoreFixtureResourceMarker(pipelineId)}\n`;
  const pendingResourceResponses = new Set();
  let resourceDownloadReleased = !blockResourceDownload;
  let resolveResourceDownloadRequest;
  const resourceDownloadRequest = new Promise((resolve) => {
    resolveResourceDownloadRequest = resolve;
  });

  function releaseResourceDownload() {
    resourceDownloadReleased = true;
    for (const response of pendingResourceResponses) {
      pendingResourceResponses.delete(response);
      if (!response.destroyed && !response.writableEnded) {
        response.end(resourceBody);
      }
    }
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", baseUrl);
    requests.push({
      method: request.method || "GET",
      path: requestUrl.pathname,
    });

    if (
      requestUrl.pathname === PIPELINE_STORE_FIXTURE_DATABASE_PATH &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (request.method === "HEAD") {
        writeText(response, 200, resourceBody, { headOnly: true });
        return;
      }

      resolveResourceDownloadRequest();
      if (resourceDownloadReleased) {
        writeText(response, 200, resourceBody);
        return;
      }

      // Send deterministic headers but retain the body until the browser test
      // has observed the persisted running job and blocked readiness state.
      writeTextHeaders(response, 200, resourceBody);
      pendingResourceResponses.add(response);
      response.once("close", () => {
        pendingResourceResponses.delete(response);
      });
      return;
    }

    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (requestUrl.pathname === "/registry") {
      const isBrokenUpdate = advertisedVersion === PIPELINE_STORE_FIXTURE_V2;
      writeJson(response, 200, {
        version: "pipeline-store-e2e-fixture",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        categories: [
          {
            id: "qc",
            name: "Quality Control",
            description: "Deterministic E2E fixtures",
          },
        ],
        pipelines: [
          {
            id: pipelineId,
            name: "SeqDesk Store E2E Fixture",
            shortDescription:
              "Local deterministic package for the pipeline store gate",
            description:
              "Verifies install, required configuration, runtime readiness, activation, and failed-update rollback.",
            category: "qc",
            latestVersion: advertisedVersion,
            version: advertisedVersion,
            versions: [
              {
                version: advertisedVersion,
                downloadUrl: isBrokenUpdate ? v2Url : v1Url,
              },
            ],
            downloadUrl: isBrokenUpdate ? v2Url : v1Url,
            provider: "SeqDesk CI",
            verified: true,
            icon: "FlaskConical",
            isPrivate: false,
            licenseRequired: false,
            targets: {
              supported: ["order"],
            },
            source: {
              kind: "registry",
              label: "SeqDesk local E2E registry",
              downloadUrl: isBrokenUpdate ? v2Url : v1Url,
            },
          },
        ],
      });
      return;
    }

    if (requestUrl.pathname === v1Path) {
      writeJson(response, 200, validPackage);
      return;
    }

    if (requestUrl.pathname === v2Path) {
      writeJson(response, 200, invalidUpdate);
      return;
    }

    writeJson(response, 404, { error: "Fixture route not found" });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(Number(baseUrl.port), baseUrl.hostname);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not resolve the pipeline store fixture port.");
  }
  const listeningUrl = new URL(baseUrl);
  listeningUrl.port = String(address.port);
  v1Url = new URL(v1Path, listeningUrl).toString();
  v2Url = new URL(v2Path, listeningUrl).toString();
  registryUrl = new URL("/registry", listeningUrl).toString();
  resourceUrl = new URL(
    PIPELINE_STORE_FIXTURE_DATABASE_PATH,
    listeningUrl
  ).toString();

  return {
    registryUrl,
    resourceUrl,
    v1Url,
    v2Url,
    requests,
    waitForResourceDownloadRequest() {
      return resourceDownloadRequest;
    },
    releaseResourceDownload,
    advertiseBrokenUpdate() {
      advertisedVersion = PIPELINE_STORE_FIXTURE_V2;
    },
    async close() {
      // Never let a failed browser assertion strand curl or make server.close
      // wait forever for a deliberately blocked response.
      releaseResourceDownload();
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
