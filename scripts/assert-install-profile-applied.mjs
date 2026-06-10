#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function parseJsonObject(raw, label) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    fail(`Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

function requireField(items, name, label) {
  if (!Array.isArray(items) || !items.some((item) => item?.name === name)) {
    fail(`Expected ${label} field '${name}' to be present`);
  }
}

function loadInstallConfig(installDir) {
  const configPath = path.join(installDir, "seqdesk.config.json");
  if (!fs.existsSync(configPath)) fail(`Missing installed config: ${configPath}`);
  return parseJsonObject(fs.readFileSync(configPath, "utf8"), configPath);
}

const args = parseArgs(process.argv.slice(2));
const installDir = args.dir ? path.resolve(args.dir) : "";
const expectedProfileId = args["profile-id"];
const expectedDeviceId = args["expected-device-id"] || "ont-minion-mk1d";

if (!installDir) fail("Missing required --dir");
if (!expectedProfileId) fail("Missing required --profile-id");

// The npm launcher installs the app under <installDir>/current (a versioned
// release), while seqdesk.config.json lives at <installDir>. Resolve app code
// (node_modules, pipelines) from the release dir when present.
const appDir = fs.existsSync(path.join(installDir, "current", "package.json"))
  ? path.join(installDir, "current")
  : installDir;

const installedConfig = loadInstallConfig(installDir);
const databaseUrl = installedConfig?.runtime?.databaseUrl;
const directUrl = installedConfig?.runtime?.directUrl || databaseUrl;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  fail("Installed config does not include runtime.databaseUrl");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directUrl;

const requireFromInstall = createRequire(path.join(appDir, "package.json"));
let PrismaClient;
try {
  ({ PrismaClient } = requireFromInstall("@prisma/client"));
} catch (error) {
  fail(
    `Failed to load @prisma/client from installed app at ${appDir}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

const prisma = new PrismaClient();

try {
  const [settings, orderForm, pipelineConfigs] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "singleton" } }),
    prisma.orderFormConfig.findUnique({ where: { id: "singleton" } }),
    prisma.pipelineConfig.findMany(),
  ]);

  if (!settings) fail("SiteSettings singleton is missing");
  if (!orderForm) fail("OrderFormConfig singleton is missing");

  const extra = parseJsonObject(settings.extraSettings, "SiteSettings.extraSettings");
  if (extra?.installProfile?.id !== expectedProfileId) {
    fail(`Expected installProfile.id '${expectedProfileId}', got '${extra?.installProfile?.id}'`);
  }

  const orderSchema = parseJsonObject(orderForm.schema, "OrderFormConfig.schema");
  requireField(orderSchema.fields, "run_type", "order");
  requireField(orderSchema.fields, "internal_sample_code", "order");
  requireField(extra.studyFormFields, "study_experiment_type", "study");
  requireField(extra.sequencingRunSampleFormFields, "barcode", "run assignment");
  requireField(extra.sequencingRunSampleFormFields, "concentration_ng_ul", "run assignment");

  const sequencingTechRaw = extra.sequencingTechConfig;
  const sequencingTech = parseJsonObject(
    typeof sequencingTechRaw === "string" ? sequencingTechRaw : JSON.stringify(sequencingTechRaw),
    "extraSettings.sequencingTechConfig"
  );
  const availableDeviceIds = Array.isArray(sequencingTech.devices)
    ? sequencingTech.devices.filter((device) => device.available).map((device) => device.id)
    : [];
  if (availableDeviceIds.length !== 1 || availableDeviceIds[0] !== expectedDeviceId) {
    fail(`Expected only ${expectedDeviceId} to be available, got ${availableDeviceIds.join(", ")}`);
  }

  if (settings.enaUsername !== "ci-webin-user" && expectedProfileId === "ci-runner") {
    fail(`Expected dummy ENA username to be applied, got '${settings.enaUsername}'`);
  }

  const telemetry = parseJsonObject(extra.telemetry, "extraSettings.telemetry");
  if (expectedProfileId === "ci-runner") {
    if (telemetry.enabled !== true) {
      fail(`Expected telemetry.enabled to be true, got '${telemetry.enabled}'`);
    }
    // Accept either domain during the seqdesk.com -> seqdesk.org migration: the
    // in-repo expectation moved to seqdesk.org, but a hosted profile may still
    // serve the www.seqdesk.com endpoint until it is updated.
    const allowedTelemetryEndpoints = [
      "https://seqdesk.org/api/telemetry/heartbeat",
      "https://www.seqdesk.com/api/telemetry/heartbeat",
      "https://seqdesk.com/api/telemetry/heartbeat",
    ];
    if (!allowedTelemetryEndpoints.includes(telemetry.endpoint)) {
      fail(
        `Expected telemetry endpoint to point at seqdesk.org or seqdesk.com, got '${telemetry.endpoint}'`
      );
    }
    if (telemetry.intervalHours !== 1) {
      fail(`Expected telemetry.intervalHours to be 1, got '${telemetry.intervalHours}'`);
    }
  }

  const enabledPipelines = pipelineConfigs
    .filter((pipeline) => pipeline.enabled)
    .map((pipeline) => pipeline.pipelineId)
    .sort();
  const expectedEnabledPipelines =
    expectedProfileId === "ci-runner"
      ? ["fastq-checksum"]
      : ["fastq-checksum", "fastqc", "metaxpath"];
  for (const expectedPipeline of expectedEnabledPipelines) {
    if (!enabledPipelines.includes(expectedPipeline)) {
      fail(`Expected pipeline '${expectedPipeline}' to be enabled`);
    }
  }
  // ci-runner's enabled pipeline set is admin-configurable (the profile is no
  // longer pinned), so only require the core pipeline to be present and allow
  // additional admin-enabled pipelines. Other profiles stay strict.
  if (expectedProfileId !== "ci-runner") {
    const unexpectedEnabledPipelines = enabledPipelines.filter(
      (pipelineId) => !expectedEnabledPipelines.includes(pipelineId)
    );
    if (unexpectedEnabledPipelines.length > 0) {
      fail(`Unexpected enabled pipeline(s): ${unexpectedEnabledPipelines.join(", ")}`);
    }
  }

  if (expectedProfileId === "twincore") {
    const metaxpathManifest = path.join(appDir, "pipelines", "metaxpath", "manifest.json");
    if (!fs.existsSync(metaxpathManifest)) {
      fail(`Expected private MetaxPath package to be installed at ${metaxpathManifest}`);
    }

    const metaxpathConfig = pipelineConfigs.find(
      (pipeline) => pipeline.pipelineId === "metaxpath"
    );
    const parsedMetaxpathConfig = parseJsonObject(
      metaxpathConfig?.config,
      "PipelineConfig.metaxpath.config"
    );
    const paramsFile = parsedMetaxpathConfig.paramsFile;
    if (typeof paramsFile !== "string" || paramsFile.trim().length === 0) {
      fail("Expected MetaxPath paramsFile to be configured after profile DB download");
    }
    if (!fs.existsSync(paramsFile)) {
      fail(`Expected MetaxPath paramsFile to exist: ${paramsFile}`);
    }

    const smokeOrder = await prisma.order.findUnique({
      where: { orderNumber: "TWINCORE-SMOKE-001" },
      include: {
        samples: {
          include: {
            reads: true,
          },
        },
      },
    });
    if (!smokeOrder) {
      fail("Expected TwinCore smoke order TWINCORE-SMOKE-001 to be seeded");
    }
    if (!settings.dataBasePath) {
      fail("Expected site dataBasePath for TwinCore smoke FASTQ files");
    }
    for (const sample of smokeOrder.samples) {
      const read = sample.reads[0];
      if (!read?.file1) {
        fail(`Expected smoke sample ${sample.sampleId} to have an R1 FASTQ`);
      }
      const fastqPath = path.join(settings.dataBasePath, read.file1);
      if (!fs.existsSync(fastqPath)) {
        fail(`Expected smoke FASTQ to exist for ${sample.sampleId}: ${fastqPath}`);
      }
    }
  }

  if (expectedProfileId === "ci-runner") {
    // MetaxPath preflight (first metaxpath check): when the admin has enabled metaxpath
    // on the ci-runner profile (it carries a DB path), the private package must be
    // installed AND its DB params file must exist on disk before any metaxpath run can
    // succeed. ci-runner's pipeline set is admin-configurable, so gate on metaxpath
    // actually being enabled — disabling it must not red the canary.
    if (enabledPipelines.includes("metaxpath")) {
      // When SEQDESK_METAXPATH_OPTIONAL is set (the install treats a metaxpath package
      // failure as a warning), the preflight matches: it still reports a missing
      // package / DB, but as a warning instead of failing the canary — so the rest of
      // the verify (e.g. the Gemma example-dataset check) still runs.
      const metaxpathOptional = ["1", "true"].includes(
        String(process.env.SEQDESK_METAXPATH_OPTIONAL || "").toLowerCase()
      );
      const flagMetaxpath = (message) => {
        if (metaxpathOptional) {
          console.warn(`WARN: ${message} (SEQDESK_METAXPATH_OPTIONAL set; not failing the canary).`);
          return false;
        }
        fail(message);
        return false;
      };
      const metaxpathManifest = path.join(appDir, "pipelines", "metaxpath", "manifest.json");
      let metaxpathOk = true;
      if (!fs.existsSync(metaxpathManifest)) {
        metaxpathOk = flagMetaxpath(
          `MetaxPath is enabled but the private package is not installed at ${metaxpathManifest}`
        );
      }
      if (metaxpathOk) {
        const metaxpathConfig = pipelineConfigs.find(
          (pipeline) => pipeline.pipelineId === "metaxpath"
        );
        const parsedMetaxpathConfig = parseJsonObject(
          metaxpathConfig?.config,
          "PipelineConfig.metaxpath.config"
        );
        const paramsFile = parsedMetaxpathConfig.paramsFile;
        if (typeof paramsFile !== "string" || paramsFile.trim().length === 0) {
          metaxpathOk = flagMetaxpath("MetaxPath is enabled but its paramsFile (DB) is not configured");
        } else if (!fs.existsSync(paramsFile)) {
          metaxpathOk = flagMetaxpath(`MetaxPath DB params file does not exist on disk: ${paramsFile}`);
        }
        if (metaxpathOk) {
          console.log(`MetaxPath preflight OK: package installed + DB params file present (${paramsFile})`);
        }
      }
    } else {
      console.log("MetaxPath not enabled on ci-runner; skipping MetaxPath preflight.");
    }

    const seedData = parseJsonObject(
      extra.installProfileSeedData,
      "extraSettings.installProfileSeedData"
    );
    const pipelineSmokeTests = parseJsonObject(
      extra.installProfilePipelineSmokeTests,
      "extraSettings.installProfilePipelineSmokeTests"
    );
    if (seedData.enabled !== true) {
      fail(`Expected ci-runner seedData.enabled to be true, got '${seedData.enabled}'`);
    }
    if (pipelineSmokeTests.enabled !== true) {
      fail(
        `Expected ci-runner pipelineSmokeTests.enabled to be true, got '${pipelineSmokeTests.enabled}'`
      );
    }
    const smokeOrder = await prisma.order.findUnique({
      where: { orderNumber: "CI-RUNNER-SMOKE-001" },
      include: {
        samples: {
          include: {
            reads: true,
          },
        },
      },
    });
    if (!smokeOrder) {
      fail("Expected CI runner smoke order CI-RUNNER-SMOKE-001 to be seeded");
    }
    if (!settings.dataBasePath) {
      fail("Expected site dataBasePath for CI runner smoke FASTQ files");
    }
    if (smokeOrder.samples.length !== 2) {
      fail(`Expected CI runner smoke order to have 2 samples, got ${smokeOrder.samples.length}`);
    }
    for (const sample of smokeOrder.samples) {
      const read = sample.reads[0];
      if (!read?.file1) {
        fail(`Expected CI runner smoke sample ${sample.sampleId} to have an R1 FASTQ`);
      }
      const fastqPath = path.join(settings.dataBasePath, read.file1);
      if (!fs.existsSync(fastqPath)) {
        fail(`Expected CI runner smoke FASTQ to exist for ${sample.sampleId}: ${fastqPath}`);
      }
    }

    // Gemma Nanopore MetaxPath example dataset (optional, admin-enabled on ci-runner):
    // when its fixture is present in the applied seed data, the installer should have
    // downloaded the repacked bundle into the sequencing data path and seeded the
    // DEV-GEMMA-ONT-001 order with its 5 ONT MinION samples + cleaned FASTQ read links.
    // Verify the order, the sample count, and that each sample's FASTQ exists on disk —
    // gated on the dataset actually being enabled (it is optional).
    const GEMMA_FIXTURE_ID = "gemma-nanopore-metaxpath-5sample";
    const GEMMA_ORDER_NUMBER = "DEV-GEMMA-ONT-001";
    const GEMMA_EXPECTED_SAMPLES = 5;
    const seedFixtures = Array.isArray(seedData.fixtures) ? seedData.fixtures : [];
    const gemmaEnabled = seedFixtures.some(
      (fixture) =>
        fixture && typeof fixture === "object" && fixture.id === GEMMA_FIXTURE_ID
    );
    if (gemmaEnabled) {
      const gemmaOrder = await prisma.order.findUnique({
        where: { orderNumber: GEMMA_ORDER_NUMBER },
        include: { samples: { include: { reads: true } } },
      });
      if (!gemmaOrder) {
        fail(`Gemma dataset is enabled but its seed order ${GEMMA_ORDER_NUMBER} is missing`);
      }
      if (gemmaOrder.samples.length !== GEMMA_EXPECTED_SAMPLES) {
        fail(
          `Expected Gemma order ${GEMMA_ORDER_NUMBER} to have ${GEMMA_EXPECTED_SAMPLES} samples, got ${gemmaOrder.samples.length}`
        );
      }
      if (!settings.dataBasePath) {
        fail("Expected site dataBasePath for Gemma dataset FASTQ files");
      }
      for (const sample of gemmaOrder.samples) {
        const read = sample.reads[0];
        if (!read?.file1) {
          fail(`Expected Gemma sample ${sample.sampleId} to have an R1 FASTQ link`);
        }
        const fastqPath = path.join(settings.dataBasePath, read.file1);
        if (!fs.existsSync(fastqPath)) {
          fail(`Expected Gemma FASTQ to exist for ${sample.sampleId}: ${fastqPath}`);
        }
      }
      console.log(
        `Gemma dataset OK: order ${GEMMA_ORDER_NUMBER} with ${gemmaOrder.samples.length} samples + FASTQ files present`
      );
    } else {
      console.log("Gemma example dataset not enabled on ci-runner; skipping its check.");
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        installProfile: extra.installProfile,
        availableDeviceIds,
        enabledPipelines,
        telemetry: {
          enabled: telemetry.enabled,
          endpoint: telemetry.endpoint,
          intervalHours: telemetry.intervalHours,
        },
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
