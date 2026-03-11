import { db } from "./db";

// Keep auto-seeding independent from external module resolution.
// These hashes correspond to the default credentials:
// admin@example.com / admin
// user@example.com  / user
const DEFAULT_ADMIN_PASSWORD_HASH =
  "$2b$12$x9euVVfr0IcQPHFKwCDO3OTz0cGPvO0AwwsgUnHOLmSVuT3wM1VzC";
const DEFAULT_USER_PASSWORD_HASH =
  "$2b$12$kbd8ye8jMpaIwxH8nVP79u/witxktRivlfVQ59IlUzyzVKCVIox2m";

let seedingInProgress = false;

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

    // 1. Create admin user
    const adminPassword = DEFAULT_ADMIN_PASSWORD_HASH;
    await db.user.upsert({
      where: { email: "admin@example.com" },
      update: {},
      create: {
        email: "admin@example.com",
        password: adminPassword,
        firstName: "Admin",
        lastName: "User",
        role: "FACILITY_ADMIN",
        facilityName: "HZI Sequencing Center",
      },
    });
    console.log("[auto-seed] Created admin user");

    // 2. Create test researcher user
    const userPassword = DEFAULT_USER_PASSWORD_HASH;
    await db.user.upsert({
      where: { email: "user@example.com" },
      update: {},
      create: {
        email: "user@example.com",
        password: userPassword,
        firstName: "Test",
        lastName: "Researcher",
        role: "RESEARCHER",
        researcherRole: "PHD_STUDENT",
        institution: "Helmholtz Centre for Infection Research",
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
          id: "system_platform",
          type: "select",
          label: "Sequencing Platform",
          name: "platform",
          required: true,
          visible: true,
          helpText: "The sequencing platform/technology used",
          options: [
            {
              value: "ILLUMINA",
              label: "Illumina (HiSeq, MiSeq, NovaSeq, NextSeq)",
            },
            {
              value: "OXFORD_NANOPORE",
              label: "Oxford Nanopore (MinION, GridION, PromethION)",
            },
            {
              value: "PACBIO_SMRT",
              label: "PacBio SMRT (Sequel, Revio)",
            },
            { value: "ION_TORRENT", label: "Ion Torrent" },
            { value: "BGI", label: "BGI/MGI" },
            { value: "OTHER", label: "Other" },
          ],
          order: 0,
          groupId: "group_sequencing",
          isSystem: true,
          systemKey: "platform",
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
          order: 1,
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
          name: "Sequencing Parameters",
          description: "Library preparation and sequencing settings",
          icon: "Settings",
          order: 1,
        },
      ],
      version: 1,
      moduleDefaultsVersion: 1,
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
