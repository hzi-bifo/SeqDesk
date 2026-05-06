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

const installedConfig = loadInstallConfig(installDir);
const databaseUrl = installedConfig?.runtime?.databaseUrl;
const directUrl = installedConfig?.runtime?.directUrl || databaseUrl;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  fail("Installed config does not include runtime.databaseUrl");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directUrl;

const requireFromInstall = createRequire(path.join(installDir, "package.json"));
let PrismaClient;
try {
  ({ PrismaClient } = requireFromInstall("@prisma/client"));
} catch (error) {
  fail(
    `Failed to load @prisma/client from installed app at ${installDir}: ${
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
    if (telemetry.endpoint !== "https://www.seqdesk.com/api/telemetry/heartbeat") {
      fail(`Expected telemetry endpoint to point at SeqDesk.com, got '${telemetry.endpoint}'`);
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
  const unexpectedEnabledPipelines = enabledPipelines.filter(
    (pipelineId) => !expectedEnabledPipelines.includes(pipelineId)
  );
  if (unexpectedEnabledPipelines.length > 0) {
    fail(`Unexpected enabled pipeline(s): ${unexpectedEnabledPipelines.join(", ")}`);
  }

  if (expectedProfileId === "twincore") {
    const metaxpathManifest = path.join(installDir, "pipelines", "metaxpath", "manifest.json");
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
