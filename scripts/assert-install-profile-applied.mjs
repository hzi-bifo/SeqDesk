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
    prisma.pipelineConfig.findMany({
      where: { pipelineId: { in: ["fastqc", "fastq-checksum", "metaxpath"] } },
    }),
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

  const enabledPipelines = pipelineConfigs
    .filter((pipeline) => pipeline.enabled)
    .map((pipeline) => pipeline.pipelineId)
    .sort();
  for (const expectedPipeline of ["fastq-checksum", "fastqc", "metaxpath"]) {
    if (!enabledPipelines.includes(expectedPipeline)) {
      fail(`Expected pipeline '${expectedPipeline}' to be enabled`);
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        installProfile: extra.installProfile,
        availableDeviceIds,
        enabledPipelines,
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
