#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ORDER_GROUPS = [
  {
    id: "group_details",
    name: "Order Details",
    description: "Basic information about the sequencing order",
    icon: "FileText",
    order: 0,
  },
  {
    id: "group_sequencing",
    name: "Sequencing Information",
    description: "Sequencing platform, library, and run settings",
    icon: "Dna",
    order: 1,
  },
];

const STUDY_GROUPS = [
  {
    id: "group_study_info",
    name: "Study Information",
    description: "Core study context and descriptive information",
    icon: "FileText",
    order: 0,
  },
  {
    id: "group_metadata",
    name: "Metadata",
    description: "Environment, submission, and structured metadata fields",
    icon: "Leaf",
    order: 1,
  },
];

const ORDER_DEFAULTS_VERSION = 1;
const STUDY_DEFAULTS_VERSION = 1;

function usage() {
  console.log(`Usage:
  node scripts/apply-form-configs.mjs [options]

Options:
  --order-form-settings <file>   JSON exported from Order Form > Import / Export
  --study-form-settings <file>   JSON exported from Study Forms > Import / Export
  -h, --help                     Show this help
`);
}

function parseArgs(argv) {
  const args = {
    orderFormSettings: process.env.SEQDESK_ORDER_FORM_SETTINGS || "",
    studyFormSettings: process.env.SEQDESK_STUDY_FORM_SETTINGS || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--order-form-settings" || arg === "--order_form_settings") {
      args.orderFormSettings = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--study-form-settings" || arg === "--study_form_settings") {
      args.studyFormSettings = argv[index + 1] || "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${resolved} must contain a JSON object`);
  }
  return { resolved, parsed };
}

function normalizeOrderFields(fields) {
  return fields.map((field) => {
    if (field.perSample || field.adminOnly || field.type === "mixs") {
      return field;
    }
    if (field.groupId === "group_details" || field.groupId === "group_sequencing") {
      return field;
    }

    const searchable = [
      field.name,
      field.label,
      field.helpText,
      field.groupId,
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    const sequencing = [
      "sequencing",
      "library",
      "instrument",
      "platform",
      "technology",
      "software",
      "read",
    ].some((token) => searchable.includes(token));

    return {
      ...field,
      groupId: sequencing ? "group_sequencing" : "group_details",
    };
  });
}

function ensureSampleAssociation(fields) {
  if (fields.some((field) => field.name === "_sample_association")) {
    return fields;
  }
  return [
    {
      id: "field_sample_association",
      type: "text",
      label: "Sample Association",
      name: "_sample_association",
      required: false,
      visible: true,
      helpText: "Interface to associate samples from orders to this study",
      order: 0,
      perSample: false,
    },
    ...fields.map((field) =>
      field.perSample ? field : { ...field, order: (field.order || 0) + 1 }
    ),
  ];
}

function normalizeStudyFields(fields) {
  return ensureSampleAssociation(fields).map((field) => {
    if (field.perSample || field.adminOnly || field.name === "_sample_association") {
      return field;
    }
    if (field.groupId === "group_study_info" || field.groupId === "group_metadata") {
      return field;
    }
    if (
      field.type === "mixs" ||
      field.type === "funding" ||
      field.name === "_mixs" ||
      field.name === "study_funding"
    ) {
      return { ...field, groupId: "group_metadata" };
    }
    return { ...field, groupId: "group_study_info" };
  });
}

function extractFields(config, label) {
  if (!Array.isArray(config.fields)) {
    throw new Error(`${label} config must include a fields array`);
  }
  return config.fields;
}

function parseExtraSettings(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function applyOrderConfig(prisma, configPath) {
  const { resolved, parsed } = readJsonFile(configPath);
  const fields = normalizeOrderFields(extractFields(parsed, "Order form"));
  const schema = {
    fields,
    groups: ORDER_GROUPS,
    enabledMixsChecklists: Array.isArray(parsed.enabledMixsChecklists)
      ? parsed.enabledMixsChecklists
      : [],
    moduleDefaultsVersion: ORDER_DEFAULTS_VERSION,
  };

  const existing = await prisma.orderFormConfig.findUnique({
    where: { id: "singleton" },
  });

  await prisma.orderFormConfig.upsert({
    where: { id: "singleton" },
    update: {
      schema: JSON.stringify(schema),
      coreFieldConfig: "{}",
      version: (existing?.version || 0) + 1,
    },
    create: {
      id: "singleton",
      schema: JSON.stringify(schema),
      coreFieldConfig: "{}",
      version: 1,
    },
  });

  if (parsed.settings && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)) {
    const settings = await prisma.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const extraSettings = parseExtraSettings(settings?.extraSettings);
    const update = {
      extraSettings: JSON.stringify({
        ...extraSettings,
        ...(typeof parsed.settings.allowDeleteSubmittedOrders === "boolean"
          ? { allowDeleteSubmittedOrders: parsed.settings.allowDeleteSubmittedOrders }
          : {}),
        ...(typeof parsed.settings.allowUserAssemblyDownload === "boolean"
          ? { allowUserAssemblyDownload: parsed.settings.allowUserAssemblyDownload }
          : {}),
      }),
      ...(typeof parsed.settings.postSubmissionInstructions === "string"
        ? { postSubmissionInstructions: parsed.settings.postSubmissionInstructions }
        : {}),
    };
    await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      update,
      create: {
        id: "singleton",
        ...update,
      },
    });
  }

  console.log(`Applied order form settings from ${resolved}`);
}

async function applyStudyConfig(prisma, configPath) {
  const { resolved, parsed } = readJsonFile(configPath);
  const fields = normalizeStudyFields(extractFields(parsed, "Study form"));

  const settings = await prisma.siteSettings.findUnique({
    where: { id: "singleton" },
  });
  const extraSettings = parseExtraSettings(settings?.extraSettings);

  await prisma.siteSettings.upsert({
    where: { id: "singleton" },
    update: {
      extraSettings: JSON.stringify({
        ...extraSettings,
        studyFormFields: fields,
        studyFormGroups: STUDY_GROUPS,
        studyFormDefaultsVersion: STUDY_DEFAULTS_VERSION,
      }),
    },
    create: {
      id: "singleton",
      extraSettings: JSON.stringify({
        studyFormFields: fields,
        studyFormGroups: STUDY_GROUPS,
        studyFormDefaultsVersion: STUDY_DEFAULTS_VERSION,
      }),
    },
  });

  console.log(`Applied study form settings from ${resolved}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.orderFormSettings && !args.studyFormSettings) {
  console.log("No form settings files provided; nothing to apply.");
  process.exit(0);
}

const prisma = new PrismaClient();
try {
  if (args.orderFormSettings) {
    await applyOrderConfig(prisma, args.orderFormSettings);
  }
  if (args.studyFormSettings) {
    await applyStudyConfig(prisma, args.studyFormSettings);
  }
} finally {
  await prisma.$disconnect();
}
