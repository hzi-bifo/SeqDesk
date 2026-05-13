import fs from "fs";
import path from "path";
import { hashSync } from "bcryptjs";
import { db } from "./db";
import { resolveDataBasePathFromStoredValue } from "./files/data-base-path";
import {
  DummySeedAlreadyExistsError,
  resolveWritableBase,
  runDummySeed,
} from "./seed/run-seed";

// Keep auto-seeding independent from external module resolution.
// These hashes correspond to the default credentials:
// admin@example.com / admin
// user@example.com  / user
const DEFAULT_ADMIN_PASSWORD_HASH =
  "$2b$12$x9euVVfr0IcQPHFKwCDO3OTz0cGPvO0AwwsgUnHOLmSVuT3wM1VzC";
const DEFAULT_USER_PASSWORD_HASH =
  "$2b$12$kbd8ye8jMpaIwxH8nVP79u/witxktRivlfVQ59IlUzyzVKCVIox2m";

type BootstrapUserConfig = Record<string, unknown>;

const CONFIG_FILE_NAMES = [
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

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

let seedingInProgress = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function envFlagTrue(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function shouldSeedDummyData(config: Record<string, unknown>): boolean {
  if (envFlagTrue("SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA")) return true;
  const bootstrap = config?.bootstrap;
  if (isRecord(bootstrap) && bootstrap.includeDummyData === true) return true;
  return false;
}

async function tryAutoSeedDummyData(adminEmail: string): Promise<void> {
  try {
    const admin = await db.user.findUnique({
      where: { email: adminEmail },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!admin) {
      console.warn("[auto-seed] Skipping dummy data: bootstrap admin missing");
      return;
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true },
    });
    const resolved = resolveDataBasePathFromStoredValue(settings?.dataBasePath);
    const resolvedBase = await resolveWritableBase(resolved.dataBasePath);
    if (!resolvedBase) {
      console.warn(
        "[auto-seed] Skipping dummy data: dataBasePath not configured or not writable"
      );
      return;
    }

    const result = await runDummySeed({
      ownerUserId: admin.id,
      resolvedBase,
      ownerEmail: admin.email,
      ownerDisplayName: [admin.firstName, admin.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
    });
    console.log(
      `[auto-seed] Seeded dummy data: ${result.ordersCreated} orders, ` +
        `${result.samplesCreated} samples, ${result.readsCreated} reads ` +
        `(${result.platform.instrumentModel}${
          result.platform.fromConfiguredDevice ? "" : ", fallback"
        })`
    );
  } catch (error) {
    if (error instanceof DummySeedAlreadyExistsError) {
      console.log("[auto-seed] Dummy data already present, skipping");
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auto-seed] Dummy data seed failed (continuing):", message);
  }
}

function trimToString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadSeedConfig(baseDir = process.cwd()): Record<string, unknown> {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, name);
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function bootstrapUserFromConfig(config: Record<string, unknown>, kind: "admin" | "researcher"): BootstrapUserConfig {
  const bootstrap = isRecord(config.bootstrap) ? config.bootstrap : {};
  const users = isRecord(bootstrap.users) ? bootstrap.users : {};
  return isRecord(users[kind]) ? users[kind] : {};
}

function firstSeedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const trimmed = trimToString(value);
    if (trimmed) return trimmed;
  }
  return undefined;
}

function resolvePasswordHash(
  kind: "admin" | "researcher",
  configUser: BootstrapUserConfig,
  defaultHash: string
): string {
  const envPrefix =
    kind === "admin" ? "SEQDESK_BOOTSTRAP_ADMIN" : "SEQDESK_BOOTSTRAP_RESEARCHER";
  const passwordHash = firstSeedString(
    process.env[`${envPrefix}_PASSWORD_HASH`],
    configUser.passwordHash
  );
  if (passwordHash) return passwordHash;

  const password = firstSeedString(process.env[`${envPrefix}_PASSWORD`], configUser.password);
  if (password) return hashSync(password, 12);

  return defaultHash;
}

function resolveBootstrapUser(
  kind: "admin",
  config: Record<string, unknown>
): typeof DEFAULT_ADMIN_USER;
function resolveBootstrapUser(
  kind: "researcher",
  config: Record<string, unknown>
): typeof DEFAULT_RESEARCHER_USER;
function resolveBootstrapUser(kind: "admin" | "researcher", config: Record<string, unknown>) {
  const configUser = bootstrapUserFromConfig(config, kind);
  if (kind === "admin") {
    return {
      email:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL, configUser.email) ??
        DEFAULT_ADMIN_USER.email,
      passwordHash: resolvePasswordHash("admin", configUser, DEFAULT_ADMIN_USER.passwordHash),
      firstName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME, configUser.firstName) ??
        DEFAULT_ADMIN_USER.firstName,
      lastName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME, configUser.lastName) ??
        DEFAULT_ADMIN_USER.lastName,
      facilityName:
        firstSeedString(process.env.SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME, configUser.facilityName) ??
        DEFAULT_ADMIN_USER.facilityName,
    };
  }

  return {
    email:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL, configUser.email) ??
      DEFAULT_RESEARCHER_USER.email,
    passwordHash: resolvePasswordHash(
      "researcher",
      configUser,
      DEFAULT_RESEARCHER_USER.passwordHash
    ),
    firstName:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME, configUser.firstName) ??
      DEFAULT_RESEARCHER_USER.firstName,
    lastName:
      firstSeedString(process.env.SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME, configUser.lastName) ??
      DEFAULT_RESEARCHER_USER.lastName,
    institution:
      firstSeedString(
        process.env.SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION,
        configUser.institution
      ) ?? DEFAULT_RESEARCHER_USER.institution,
    researcherRole:
      firstSeedString(
        process.env.SEQDESK_BOOTSTRAP_RESEARCHER_ROLE,
        configUser.researcherRole,
        configUser.role
      ) ?? DEFAULT_RESEARCHER_USER.researcherRole,
  };
}

/**
 * Automatically seed the database with initial data if it hasn't been seeded yet.
 * This runs within the Next.js app process so it doesn't depend on external CLI tools.
 * Uses upsert operations so it's safe to call multiple times.
 */
export async function autoSeedIfNeeded(): Promise<{
  seeded: boolean;
  error?: string;
}> {
  if (seedingInProgress) {
    return { seeded: false, error: "Seeding already in progress" };
  }

  try {
    // Check if already seeded
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    if (settings) {
      return { seeded: false }; // Already seeded
    }

    seedingInProgress = true;
    console.log("[auto-seed] Database not seeded, seeding now...");
    const seedConfig = loadSeedConfig();

    // 1. Create admin user
    const adminBootstrap = resolveBootstrapUser("admin", seedConfig);
    const adminPassword = adminBootstrap.passwordHash;
    await db.user.upsert({
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
    console.log("[auto-seed] Created admin user");

    // 2. Create test researcher user
    const researcherBootstrap = resolveBootstrapUser("researcher", seedConfig);
    const userPassword = researcherBootstrap.passwordHash;
    await db.user.upsert({
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
    console.log("[auto-seed] Created test user");

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

    await db.siteSettings.upsert({
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
    console.log("[auto-seed] Created site settings");

    // 4. Create default ORDER form configuration
    const defaultOrderFormSchema = {
      fields: [
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
        {
          id: "field_facility_qc_status",
          type: "select",
          label: "Internal QC Status",
          name: "facility_qc_status",
          required: false,
          visible: true,
          helpText: "Facility-only QC checkpoint for tracking internal review on this order.",
          options: [
            { value: "pending", label: "Pending" },
            { value: "in_review", label: "In Review" },
            { value: "passed", label: "Passed" },
            { value: "needs_follow_up", label: "Needs Follow-up" },
          ],
          order: 4,
          adminOnly: true,
          perSample: false,
        },
        {
          id: "field_facility_internal_notes",
          type: "textarea",
          label: "Internal Notes",
          name: "facility_internal_notes",
          required: false,
          visible: true,
          helpText: "Facility-only notes about intake, coordination, or follow-up for this order.",
          placeholder: "Internal notes for the sequencing team...",
          order: 5,
          adminOnly: true,
          perSample: false,
        },
        {
          id: "system_numberOfSamples",
          type: "number",
          label: "Number of Samples",
          name: "numberOfSamples",
          required: false,
          visible: true,
          placeholder: "e.g., 48",
          helpText:
            "Expected number of samples. This will pre-fill the samples table with empty rows.",
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
        {
          id: "system_organism",
          type: "organism",
          label: "Organism",
          name: "_organism",
          required: true,
          visible: true,
          helpText:
            "The source organism or metagenome type. Start typing to search NCBI taxonomy.",
          placeholder: "e.g., human gut metagenome",
          order: 0,
          isSystem: true,
          perSample: true,
          moduleSource: "ena-sample-fields",
        },
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
        {
          id: "field_facility_sample_qc_result",
          type: "select",
          label: "Sample QC Result",
          name: "facility_sample_qc_result",
          required: false,
          visible: true,
          helpText: "Facility-only QC result for this sample after internal review.",
          options: [
            { value: "pending", label: "Pending" },
            { value: "passed", label: "Passed" },
            { value: "failed", label: "Failed" },
            { value: "repeat_requested", label: "Repeat Requested" },
          ],
          order: 3,
          adminOnly: true,
          perSample: true,
        },
        {
          id: "field_facility_sample_notes",
          type: "textarea",
          label: "Sample Notes",
          name: "facility_sample_notes",
          required: false,
          visible: true,
          helpText: "Facility-only notes for this sample, such as handling issues or follow-up comments.",
          placeholder: "Internal sample notes...",
          order: 4,
          adminOnly: true,
          perSample: true,
        },
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
        {
          id: "sample_concentration",
          type: "number",
          label: "Concentration (ng/uL)",
          name: "sample_concentration",
          required: false,
          visible: true,
          placeholder: "e.g., 25",
          helpText:
            "DNA/RNA concentration in nanograms per microliter",
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
          name: "Sequencing Information",
          description: "Library preparation and sequencing settings",
          icon: "Settings",
          order: 1,
        },
      ],
      version: 1,
      moduleDefaultsVersion: 4,
    };

    await db.orderFormConfig.upsert({
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
    console.log("[auto-seed] Created default ORDER form configuration");

    // 5. Create default STUDY form configuration
    const studyFormFields = [
      {
        id: "field_sample_association",
        type: "text",
        label: "Sample Association",
        name: "_sample_association",
        required: false,
        visible: true,
        helpText:
          "Interface to associate samples from orders to this study",
        order: 0,
        perSample: false,
      },
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
      {
        id: "study_abstract",
        type: "textarea",
        label: "Study Abstract",
        name: "study_abstract",
        required: false,
        visible: true,
        placeholder:
          "Describe the scientific objectives and methodology of your study...",
        helpText: "Brief description of the study for ENA submission",
        order: 2,
        groupId: "group_study_info",
        perSample: false,
      },
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
      {
        id: "collection_date",
        type: "date",
        label: "Collection Date",
        name: "collection_date",
        required: false,
        visible: true,
        helpText:
          "Date when the sample was collected (ISO 8601 format)",
        order: 3,
        perSample: true,
      },
      {
        id: "geographic_location",
        type: "text",
        label: "Geographic Location",
        name: "geographic_location",
        required: false,
        visible: true,
        placeholder: "e.g., Germany:Lower Saxony:Braunschweig",
        helpText:
          "Location where the sample was collected (country:region:locality)",
        order: 4,
        perSample: true,
      },
    ];

    const studyFormGroups = [
      {
        id: "group_study_info",
        name: "Study Information",
        description:
          "Basic information about your study for ENA submission",
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

    await db.siteSettings.update({
      where: { id: "singleton" },
      data: {
        extraSettings: JSON.stringify({
          studyFormFields,
          studyFormGroups,
          studyFormDefaultsVersion: 1,
        }),
      },
    });
    console.log("[auto-seed] Created default STUDY form configuration");

    // 5. Optionally seed realistic dummy orders / samples / reads on first install.
    //    Off by default; opt in by setting SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA=true
    //    (also accepts bootstrap.includeDummyData=true in seqdesk.config.json).
    if (shouldSeedDummyData(seedConfig)) {
      await tryAutoSeedDummyData(adminBootstrap.email);
    }

    console.log("[auto-seed] Database seeding completed successfully");
    return { seeded: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error("[auto-seed] Seeding failed:", message);
    return { seeded: false, error: message };
  } finally {
    seedingInProgress = false;
  }
}
