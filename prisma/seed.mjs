import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const CONFIG_FILE_NAMES = [
  "settings.json",
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

function trimToString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

// Load bundled sequencing technology defaults from data/. Used at seed time so
// the order form has technologies to choose from without hitting the remote
// registry at seqdesk.org (which is unreachable from CI / air-gapped installs).
function loadBundledSequencingTechConfig() {
  const repoRoot = process.cwd();
  const defaultsPath = path.join(
    repoRoot,
    "data",
    "sequencing-technologies",
    "defaults.json",
  );
  const devicesDir = path.join(repoRoot, "data", "sequencing-devices");

  let baseConfig;
  try {
    baseConfig = JSON.parse(fs.readFileSync(defaultsPath, "utf-8"));
  } catch (error) {
    console.warn("Could not read sequencing technology defaults:", error?.message || error);
    return null;
  }

  if (!isRecord(baseConfig) || !Array.isArray(baseConfig.technologies)) {
    return null;
  }

  // Per-platform device files contribute devices/flowCells/kits/software.
  const devices = [];
  const flowCells = [];
  const kits = [];
  const software = [];
  if (fs.existsSync(devicesDir)) {
    for (const file of fs.readdirSync(devicesDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(devicesDir, file), "utf-8"));
        const platformId = parsed?.platformId;
        if (Array.isArray(parsed?.devices)) {
          for (const device of parsed.devices) {
            devices.push({ ...device, platformId: device.platformId || platformId });
          }
        }
        if (Array.isArray(parsed?.flowCells)) flowCells.push(...parsed.flowCells);
        if (Array.isArray(parsed?.kits)) kits.push(...parsed.kits);
        if (Array.isArray(parsed?.software)) software.push(...parsed.software);
      } catch (error) {
        console.warn(`Could not parse ${file}:`, error?.message || error);
      }
    }
  }

  return {
    technologies: baseConfig.technologies,
    devices,
    flowCells,
    kits,
    software,
    barcodeSchemes: Array.isArray(baseConfig.barcodeSchemes) ? baseConfig.barcodeSchemes : [],
    barcodeSets: Array.isArray(baseConfig.barcodeSets) ? baseConfig.barcodeSets : [],
    version: typeof baseConfig.version === "number" ? baseConfig.version : 1,
    lastSyncedAt: new Date().toISOString(),
  };
}

function findConfigPath(baseDir) {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadSeedConfig(baseDir = process.cwd()) {
  const configPath = findConfigPath(baseDir);
  if (!configPath) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function bootstrapSeedRuntimeEnv(config) {
  try {
    const runtime = isRecord(config.runtime) ? config.runtime : undefined;

    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
      return;
    }

    const databaseUrl = trimToString(runtime.databaseUrl);
    const directUrl = trimToString(runtime.directUrl);

    if (!process.env.DATABASE_URL && databaseUrl) {
      process.env.DATABASE_URL = databaseUrl;
    }

    if (!process.env.DIRECT_URL) {
      process.env.DIRECT_URL = directUrl || process.env.DATABASE_URL;
    }
  } catch {
    // Ignore invalid JSON and keep the caller's environment untouched.
  }
}

const seedConfig = loadSeedConfig();
bootstrapSeedRuntimeEnv(seedConfig);

// Keep seeding independent from runtime dependency resolution.
// These are bcrypt hashes for the default credentials:
// admin@example.com / admin
// user@example.com  / user
const DEFAULT_ADMIN_PASSWORD_HASH =
  "$2b$12$x9euVVfr0IcQPHFKwCDO3OTz0cGPvO0AwwsgUnHOLmSVuT3wM1VzC";
const DEFAULT_USER_PASSWORD_HASH =
  "$2b$12$kbd8ye8jMpaIwxH8nVP79u/witxktRivlfVQ59IlUzyzVKCVIox2m";

const DEFAULT_ADMIN_USER = {
  email: "admin@example.com",
  passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
  firstName: "Admin",
  lastName: "User",
  facilityName: "HZI Sequencing Center",
};

const DEFAULT_RESEARCHER_USER = {
  email: "user@example.com",
  passwordHash: DEFAULT_USER_PASSWORD_HASH,
  firstName: "Test",
  lastName: "Researcher",
  institution: "Helmholtz Centre for Infection Research",
  researcherRole: "PHD_STUDENT",
};

function bootstrapUserFromConfig(kind) {
  const bootstrap = isRecord(seedConfig.bootstrap) ? seedConfig.bootstrap : {};
  const users = isRecord(bootstrap.users) ? bootstrap.users : {};
  return isRecord(users[kind]) ? users[kind] : {};
}

function envNameFor(kind, field) {
  const prefix = kind === "admin" ? "SEQDESK_BOOTSTRAP_ADMIN" : "SEQDESK_BOOTSTRAP_RESEARCHER";
  return `${prefix}_${field}`;
}

function firstSeedString(...values) {
  for (const value of values) {
    const trimmed = trimToString(value);
    if (trimmed) return trimmed;
  }
  return undefined;
}

function resolvePasswordHash(kind, configUser, defaultHash) {
  const passwordHash = firstSeedString(
    process.env[envNameFor(kind, "PASSWORD_HASH")],
    configUser.passwordHash
  );
  if (passwordHash) return passwordHash;

  const password = firstSeedString(
    process.env[envNameFor(kind, "PASSWORD")],
    configUser.password
  );
  if (password) return hashSync(password, 12);

  return defaultHash;
}

function resolveBootstrapUser(kind, defaults) {
  const configUser = bootstrapUserFromConfig(kind);
  if (kind === "admin") {
    return {
      email: firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL, configUser.email) ?? defaults.email,
      passwordHash: resolvePasswordHash(kind, configUser, defaults.passwordHash),
      firstName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME, configUser.firstName) ??
        defaults.firstName,
      lastName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME, configUser.lastName) ??
        defaults.lastName,
      facilityName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME, configUser.facilityName) ??
        defaults.facilityName,
    };
  }

  return {
    email:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL, configUser.email) ??
      defaults.email,
    passwordHash: resolvePasswordHash(kind, configUser, defaults.passwordHash),
    firstName:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME, configUser.firstName) ??
      defaults.firstName,
    lastName:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME, configUser.lastName) ??
      defaults.lastName,
    institution:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION, configUser.institution) ??
      defaults.institution,
    researcherRole:
      firstSeedString(
        process.env.SEQDESK_BOOTSTRAP_RESEARCHER_ROLE,
        configUser.researcherRole,
        configUser.role
      ) ?? defaults.researcherRole,
  };
}

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...\n");

  // 1. Create admin user
  const adminBootstrap = resolveBootstrapUser("admin", DEFAULT_ADMIN_USER);
  const adminPassword = adminBootstrap.passwordHash;

  const admin = await prisma.user.upsert({
    where: { email: adminBootstrap.email },
    update: {},
    create: {
      email: adminBootstrap.email,
      password: adminPassword,
      firstName: adminBootstrap.firstName,
      lastName: adminBootstrap.lastName,
      role: "FACILITY_ADMIN",
      facilityName: adminBootstrap.facilityName,
    },
  });
  console.log(`Created admin user: ${adminBootstrap.email}`);

  // 2. Create test researcher user
  const researcherBootstrap = resolveBootstrapUser("researcher", DEFAULT_RESEARCHER_USER);
  const userPassword = researcherBootstrap.passwordHash;

  const testUser = await prisma.user.upsert({
    where: { email: researcherBootstrap.email },
    update: {},
    create: {
      email: researcherBootstrap.email,
      password: userPassword,
      firstName: researcherBootstrap.firstName,
      lastName: researcherBootstrap.lastName,
      role: "RESEARCHER",
      researcherRole: researcherBootstrap.researcherRole,
      institution: researcherBootstrap.institution,
    },
  });
  console.log(`Created researcher user: ${researcherBootstrap.email}`);

  // 3. Create site settings
  const defaultPostSubmissionInstructions = `## Thank you for your submission!

Your sequencing order has been received and is now being processed.

### Next Steps

1. **Prepare your samples** according to the guidelines provided
2. **Label each sample** with the Sample ID shown in your order
3. **Ship samples to:**

   Sequencing Facility
   123 Science Drive
   Lab Building, Room 456
   City, State 12345

4. **Include a printed copy** of your order summary in the package

### Important Notes

- Samples should be shipped on dry ice for overnight delivery
- Please notify us when samples are shipped by emailing sequencing@example.com
- Processing typically begins within 3-5 business days of sample receipt

### Questions?

Contact us at sequencing@example.com or call (555) 123-4567.`;

  await prisma.siteSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      siteName: "SeqDesk",
      primaryColor: "#3b82f6",
      secondaryColor: "#1e40af",
      contactEmail: "support@example.com",
      postSubmissionInstructions: defaultPostSubmissionInstructions,
    },
  });
  console.log("Created site settings");

  // 4. Create default ORDER form configuration
  const defaultOrderFormSchema = {
    fields: [
      // Order-level field: Order Name
      {
        id: "system_name",
        type: "text",
        label: "Order Name",
        name: "name",
        required: true,
        visible: true,
        placeholder: "e.g., Soil microbiome study - Batch 1",
        helpText: "A descriptive name for this sequencing order",
        order: 0,
        groupId: "group_details",
        isSystem: true,
        systemKey: "name",
        perSample: false,
      },
      // Order-level field: Sequencing Technology Selector
      {
        id: "field_seqtech_default",
        type: "sequencing-tech",
        label: "Sequencing Technology",
        name: "_sequencing_tech",
        required: false,
        visible: true,
        helpText: "Select the sequencing technology for your samples",
        order: 0,
        groupId: "group_sequencing",
        moduleSource: "sequencing-tech",
        perSample: false,
      },
      // Order-level field: Library Strategy
      {
        id: "system_libraryStrategy",
        type: "select",
        label: "Library Strategy",
        name: "libraryStrategy",
        required: false,
        visible: true,
        helpText: "The sequencing strategy for library preparation",
        options: [
          { value: "WGS", label: "WGS (Whole Genome Sequencing)" },
          { value: "WXS", label: "WXS (Whole Exome Sequencing)" },
          { value: "RNA-Seq", label: "RNA-Seq" },
          { value: "AMPLICON", label: "Amplicon (16S/18S/ITS)" },
          { value: "Bisulfite-Seq", label: "Bisulfite-Seq" },
          { value: "ChIP-Seq", label: "ChIP-Seq" },
          { value: "OTHER", label: "Other" },
        ],
        order: 2,
        groupId: "group_sequencing",
        isSystem: true,
        systemKey: "libraryStrategy",
        perSample: false,
      },
      // Order-level field: Library Source
      {
        id: "system_librarySource",
        type: "select",
        label: "Library Source",
        name: "librarySource",
        required: false,
        visible: true,
        helpText: "The type of source material being sequenced",
        options: [
          { value: "GENOMIC", label: "Genomic DNA" },
          { value: "METAGENOMIC", label: "Metagenomic" },
          { value: "TRANSCRIPTOMIC", label: "Transcriptomic" },
          { value: "METATRANSCRIPTOMIC", label: "Metatranscriptomic" },
          { value: "SYNTHETIC", label: "Synthetic" },
          { value: "OTHER", label: "Other" },
        ],
        order: 3,
        groupId: "group_sequencing",
        isSystem: true,
        systemKey: "librarySource",
        perSample: false,
      },
      // Order-level field: Number of Samples
      {
        id: "system_numberOfSamples",
        type: "number",
        label: "Number of Samples",
        name: "numberOfSamples",
        required: false,
        visible: true,
        placeholder: "e.g., 48",
        helpText: "Expected number of samples. This will pre-fill the samples table with empty rows.",
        simpleValidation: {
          minValue: 1,
          maxValue: 10000,
        },
        order: 1,
        groupId: "group_details",
        isSystem: true,
        systemKey: "numberOfSamples",
        perSample: false,
      },
      // Per-sample field: Organism (ENA)
      {
        id: "system_organism",
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
        visible: true,
        helpText: "The source organism or metagenome type. Start typing to search NCBI taxonomy.",
        placeholder: "e.g., human gut metagenome",
        order: 0,
        isSystem: true,
        perSample: true,
        moduleSource: "ena-sample-fields",
      },
      // Per-sample field: Sample Title (ENA)
      {
        id: "system_sampleTitle",
        type: "text",
        label: "Sample Title",
        name: "sample_title",
        required: true,
        visible: true,
        helpText: "A short descriptive title for this sample. Required for ENA submission.",
        placeholder: "e.g., Human gut sample from healthy adult",
        order: 1,
        isSystem: true,
        perSample: true,
        moduleSource: "ena-sample-fields",
      },
      // Per-sample field: Sample Alias (ENA)
      {
        id: "system_sampleAlias",
        type: "text",
        label: "Sample Alias",
        name: "sample_alias",
        required: false,
        visible: true,
        helpText: "A unique identifier for this sample. If left empty, it can be auto-generated.",
        placeholder: "e.g., HG-001-A",
        order: 2,
        isSystem: true,
        perSample: true,
        moduleSource: "ena-sample-fields",
      },
      // Per-sample field: Sample Volume
      {
        id: "sample_volume",
        type: "number",
        label: "Sample Volume (uL)",
        name: "sample_volume",
        required: false,
        visible: true,
        placeholder: "e.g., 50",
        helpText: "Volume of the sample in microliters",
        order: 4,
        perSample: true,
      },
      // Per-sample field: Concentration
      {
        id: "sample_concentration",
        type: "number",
        label: "Concentration (ng/uL)",
        name: "sample_concentration",
        required: false,
        visible: true,
        placeholder: "e.g., 25",
        helpText: "DNA/RNA concentration in nanograms per microliter",
        order: 5,
        perSample: true,
      },
    ],
    groups: [
      {
        id: "group_details",
        name: "Order Details",
        description: "Basic information about your sequencing order",
        icon: "FileText",
        order: 0,
      },
      {
        id: "group_sequencing",
        name: "Sequencing Parameters",
        description: "Library preparation and sequencing settings",
        icon: "Settings",
        order: 1,
      },
    ],
    version: 1,
    moduleDefaultsVersion: 4,
  };

  await prisma.orderFormConfig.upsert({
    where: { id: "singleton" },
    update: {
      schema: JSON.stringify(defaultOrderFormSchema),
    },
    create: {
      id: "singleton",
      schema: JSON.stringify(defaultOrderFormSchema),
      coreFieldConfig: JSON.stringify({}),
      version: 1,
    },
  });
  console.log("Created default ORDER form configuration");

  // 5. Create default STUDY form configuration (stored in siteSettings.extraSettings)
  const studyFormFields = [
    // Sample Association module - enabled by default
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
    // Study-level field: Principal Investigator
    {
      id: "principal_investigator",
      type: "text",
      label: "Principal Investigator",
      name: "principal_investigator",
      required: false,
      visible: true,
      placeholder: "e.g., Dr. Jane Smith",
      helpText: "Lead researcher responsible for this study",
      order: 1,
      groupId: "group_study_info",
      perSample: false,
    },
    // Study-level field: Study Abstract
    {
      id: "study_abstract",
      type: "textarea",
      label: "Study Abstract",
      name: "study_abstract",
      required: false,
      visible: true,
      placeholder: "Describe the scientific objectives and methodology of your study...",
      helpText: "Brief description of the study for ENA submission",
      order: 2,
      groupId: "group_study_info",
      perSample: false,
    },
    // Study-level field: MIxS Metadata
    {
      id: "field_mixs_default",
      type: "mixs",
      label: "MIxS Metadata",
      name: "_mixs",
      required: false,
      visible: true,
      helpText: "Environment-specific metadata fields following MIxS standards",
      order: 3,
      groupId: "group_metadata",
      perSample: false,
      moduleSource: "mixs-metadata",
    },
    // Per-sample field: Collection Date
    {
      id: "collection_date",
      type: "date",
      label: "Collection Date",
      name: "collection_date",
      required: false,
      visible: true,
      helpText: "Date when the sample was collected (ISO 8601 format)",
      order: 3,
      perSample: true,
    },
    // Per-sample field: Geographic Location
    {
      id: "geographic_location",
      type: "text",
      label: "Geographic Location",
      name: "geographic_location",
      required: false,
      visible: true,
      placeholder: "e.g., Germany:Lower Saxony:Braunschweig",
      helpText: "Location where the sample was collected (country:region:locality)",
      order: 4,
      perSample: true,
    },
  ];

  const studyFormGroups = [
    {
      id: "group_study_info",
      name: "Study Information",
      description: "Basic information about your study for ENA submission",
      icon: "FileText",
      order: 0,
    },
    {
      id: "group_metadata",
      name: "Sample Metadata",
      description: "Per-sample metadata fields",
      icon: "Table",
      order: 1,
    },
  ];

  // Load bundled sequencing technology defaults so the order form can render
  // without an external network fetch. This mirrors what /api/sequencing-tech
  // would otherwise pull from the seqdesk.org registry, but lets fresh installs
  // and offline CI environments work out of the box.
  const sequencingTechConfig = loadBundledSequencingTechConfig();

  // Update siteSettings with study form config
  await prisma.siteSettings.update({
    where: { id: "singleton" },
    data: {
      extraSettings: JSON.stringify({
        studyFormFields,
        studyFormGroups,
        studyFormDefaultsVersion: 1,
        ...(sequencingTechConfig ? { sequencingTechConfig } : {}),
      }),
    },
  });
  console.log("Created default STUDY form configuration");
  if (sequencingTechConfig) {
    console.log(
      `Seeded ${sequencingTechConfig.technologies.length} sequencing technologies from bundled defaults`,
    );
  }

  console.log("\n========================================");
  console.log("Seeding completed!");
  console.log("========================================");
  console.log("\nBootstrap login accounts:");
  console.log(`  Admin:      ${adminBootstrap.email}`);
  console.log(`  Researcher: ${researcherBootstrap.email}`);
  console.log("  Passwords are configured by the installer profile or defaults.");
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
