import { hash } from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { encode } from "next-auth/jwt";
import { autoSeedIfNeeded } from "@/lib/auto-seed";
import { db } from "@/lib/db";
import {
  DEMO_SEED_VERSION,
  DEMO_SESSION_TTL_HOURS,
  DEMO_WORKSPACE_COOKIE,
  isPublicDemoEnabled,
} from "./config";
import {
  addDemoProjectsFieldToSchema,
  getDemoSiteSettingsUpdate,
} from "./seed";
import {
  type DemoExperience,
  normalizeDemoExperience,
} from "./types";

type DemoBootstrapResult = {
  created: boolean;
  expiresAt: Date;
  token: string;
  userId: string;
  workspaceId: string;
};

type DemoSeedResult = {
  expiresAt: Date;
  token: string;
  workspaceId: string;
  researcherUserId: string;
  adminUserId: string;
};

type DemoWorkspaceRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  adminUserId: string | null;
  seedVersion: number;
  lastSeenAt: Date;
  expiresAt: Date;
};

type DemoWorkspaceUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isDemo: boolean;
};

export type DemoAuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isDemo: boolean;
  demoExperience: DemoExperience;
};

type DemoWorkspaceWithUsers = DemoWorkspaceRecord & {
  user: DemoWorkspaceUser;
  adminUser: DemoWorkspaceUser | null;
};

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function hashDemoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createDemoToken(): string {
  return randomBytes(32).toString("hex");
}

function createDemoEmail(
  token: string,
  demoExperience: DemoExperience
): string {
  const prefix = demoExperience === "facility" ? "facility" : "researcher";
  return `demo-${prefix}-${token.slice(0, 12)}@seqdesk.local`;
}

function createOrderNumber(prefix: string, index: number): string {
  return `DEMO-${prefix}-${String(index).padStart(3, "0")}`;
}

function createRunNumber(prefix: string, pipeline = "MAG", index = 1): string {
  return `${pipeline}-${prefix}-${String(index).padStart(3, "0")}`;
}

function createSampleId(
  prefix: string,
  orderIndex: number,
  sampleIndex: number
): string {
  return `D-${prefix}-${orderIndex}${String(sampleIndex).padStart(2, "0")}`;
}

function getStudyMetadata(
  principalInvestigator: string,
  abstract: string
): Record<string, string> {
  return {
    principal_investigator: principalInvestigator,
    study_abstract: abstract,
  };
}

function getDemoUserIdForExperience(
  data:
    | DemoWorkspaceWithUsers
    | Pick<DemoSeedResult, "researcherUserId" | "adminUserId">,
  demoExperience: DemoExperience
): string {
  const researcherUserId =
    "researcherUserId" in data ? data.researcherUserId : data.userId;
  const adminUserId = data.adminUserId;

  return demoExperience === "facility"
    ? adminUserId ?? researcherUserId
    : researcherUserId;
}

function toDemoAuthUser(
  user: DemoWorkspaceUser,
  demoExperience: DemoExperience
): DemoAuthUser {
  return {
    ...user,
    demoExperience,
  };
}

function selectWorkspaceUser(
  workspace: DemoWorkspaceWithUsers,
  demoExperience: DemoExperience
): DemoWorkspaceUser | null {
  return demoExperience === "facility" ? workspace.adminUser : workspace.user;
}

function isWorkspaceReusable(workspace: DemoWorkspaceWithUsers | null): boolean {
  return Boolean(
    workspace &&
      workspace.adminUserId &&
      workspace.adminUser &&
      workspace.seedVersion === DEMO_SEED_VERSION &&
      workspace.expiresAt.getTime() > Date.now()
  );
}

async function ensureDemoBaseState(): Promise<void> {
  await autoSeedIfNeeded();

  const currentSettings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    update: getDemoSiteSettingsUpdate(currentSettings?.extraSettings ?? null),
    create: {
      id: "singleton",
      primaryColor: "#3b82f6",
      secondaryColor: "#1e40af",
      postSubmissionInstructions:
        "This demo installation does not send real samples or contact external services.",
      ...getDemoSiteSettingsUpdate(null),
    },
  });

  const orderFormConfig = await db.orderFormConfig.findUnique({
    where: { id: "singleton" },
  });

  if (orderFormConfig) {
    await db.orderFormConfig.update({
      where: { id: "singleton" },
      data: {
        schema: addDemoProjectsFieldToSchema(orderFormConfig.schema),
      },
    });
  }
}

async function createDemoWorkspaceInternal(
  preferredToken?: string | null
): Promise<DemoSeedResult> {
  await ensureDemoBaseState();

  const now = new Date();
  const expiresAt = addHours(now, DEMO_SESSION_TTL_HOURS);
  const rawToken = preferredToken?.trim() || createDemoToken();
  const tokenHash = hashDemoToken(rawToken);
  const prefix = rawToken.slice(0, 6).toUpperCase();
  const researcherEmail = createDemoEmail(rawToken, "researcher");
  const adminEmail = createDemoEmail(rawToken, "facility");
  const passwordHash = await hash(rawToken, 10);
  const demoRoot = `demo/${prefix.toLowerCase()}`;

  const result = await db.$transaction(async (tx) => {
    const researcher = await tx.user.create({
      data: {
        email: researcherEmail,
        password: passwordHash,
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
        institution: "SeqDesk Demo Workspace",
        researcherRole: "POSTDOC",
      },
    });

    const facilityAdmin = await tx.user.create({
      data: {
        email: adminEmail,
        password: passwordHash,
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
        facilityName: "SeqDesk Demo Facility",
      },
    });

    const workspace = await tx.demoWorkspace.create({
      data: {
        tokenHash,
        userId: researcher.id,
        adminUserId: facilityAdmin.id,
        seedVersion: DEMO_SEED_VERSION,
        lastSeenAt: now,
        expiresAt,
      },
    });

    const readyStudy = await tx.study.create({
      data: {
        title: "Gut Recovery Cohort",
        alias: `gut-recovery-${prefix.toLowerCase()}`,
        description:
          "Longitudinal metagenome study tracking recovery after treatment.",
        checklistType: "Human Gut",
        studyMetadata: JSON.stringify(
          getStudyMetadata(
            "Dr. Lena Hartmann",
            "Longitudinal study following gut microbiome recovery after antibiotic treatment."
          )
        ),
        readyForSubmission: true,
        readyAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        userId: researcher.id,
      },
    });

    const pilotStudy = await tx.study.create({
      data: {
        title: "Surface Resistome Pilot",
        alias: `surface-pilot-${prefix.toLowerCase()}`,
        description:
          "Pilot study comparing resistome profiles from surface swab collections.",
        checklistType: "Built Environment",
        studyMetadata: JSON.stringify(
          getStudyMetadata(
            "Dr. Maya Nguyen",
            "Pilot screen of resistome markers across public-touch surface samples."
          )
        ),
        userId: researcher.id,
      },
    });

    const draftOrder = await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 1),
        name: "Draft host-associated screening batch",
        status: "DRAFT",
        numberOfSamples: 2,
        contactName: "Demo Researcher",
        contactEmail: researcherEmail,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "MiSeq",
        libraryStrategy: "AMPLICON",
        librarySource: "METAGENOMIC",
        customFields: JSON.stringify({
          _projects: "Screening batch\nValidation panel",
        }),
        userId: researcher.id,
        samples: {
          create: [
            {
              sampleId: createSampleId(prefix, 1, 1),
              sampleAlias: "HS-01",
              sampleTitle: "Host sample 01",
              scientificName: "human gut metagenome",
              taxId: "408170",
              customFields: JSON.stringify({
                sample_volume: "40",
                sample_concentration: "18",
              }),
            },
            {
              sampleId: createSampleId(prefix, 1, 2),
              sampleAlias: "HS-02",
              sampleTitle: "Host sample 02",
              scientificName: "human gut metagenome",
              taxId: "408170",
              customFields: JSON.stringify({
                sample_volume: "45",
                sample_concentration: "20",
              }),
            },
          ],
        },
      },
    });

    const submittedOrder = await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 2),
        name: "Gut recovery metagenome cohort",
        status: "SUBMITTED",
        statusUpdatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        numberOfSamples: 3,
        contactName: "Demo Researcher",
        contactEmail: researcherEmail,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "NovaSeq 6000",
        libraryStrategy: "WGS",
        librarySource: "METAGENOMIC",
        customFields: JSON.stringify({
          _projects: "Gut recovery cohort\nTimepoint atlas",
        }),
        userId: researcher.id,
        samples: {
          create: [
            {
              sampleId: createSampleId(prefix, 2, 1),
              sampleAlias: "GR-01",
              sampleTitle: "Gut recovery day 0",
              scientificName: "human gut metagenome",
              taxId: "408170",
              checklistData: JSON.stringify({
                collection_date: "2026-02-01",
                geographic_location: "Germany:Lower Saxony:Braunschweig",
                host_body_site: "stool",
              }),
              customFields: JSON.stringify({
                sample_volume: "50",
                sample_concentration: "24",
              }),
              study: {
                connect: { id: readyStudy.id },
              },
            },
            {
              sampleId: createSampleId(prefix, 2, 2),
              sampleAlias: "GR-02",
              sampleTitle: "Gut recovery day 14",
              scientificName: "human gut metagenome",
              taxId: "408170",
              checklistData: JSON.stringify({
                collection_date: "2026-02-14",
                geographic_location: "Germany:Lower Saxony:Braunschweig",
                host_body_site: "stool",
              }),
              customFields: JSON.stringify({
                sample_volume: "48",
                sample_concentration: "22",
              }),
              study: {
                connect: { id: readyStudy.id },
              },
            },
            {
              sampleId: createSampleId(prefix, 2, 3),
              sampleAlias: "GR-03",
              sampleTitle: "Gut recovery day 28",
              scientificName: "human gut metagenome",
              taxId: "408170",
              checklistData: JSON.stringify({
                collection_date: "2026-02-28",
                geographic_location: "Germany:Lower Saxony:Braunschweig",
                host_body_site: "stool",
              }),
              customFields: JSON.stringify({
                sample_volume: "52",
                sample_concentration: "25",
              }),
              study: {
                connect: { id: readyStudy.id },
              },
            },
          ],
        },
      },
      include: {
        samples: {
          select: {
            id: true,
            sampleId: true,
          },
        },
      },
    });

    // ── Order-scoped pipeline demo data for submitted order ──────────
    const simRunAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const ckRunAt = new Date(now.getTime() - 90 * 60 * 1000);
    const qcRunAt = new Date(now.getTime() - 60 * 60 * 1000);

    const simRun = await tx.pipelineRun.create({
      data: {
        runNumber: createRunNumber(prefix, "SIMULATE-READS"),
        pipelineId: "simulate-reads",
        status: "completed",
        progress: 100,
        currentStep: "Completed",
        orderId: submittedOrder.id,
        userId: facilityAdmin.id,
        inputSampleIds: JSON.stringify(submittedOrder.samples.map((s) => s.id)),
        config: JSON.stringify({ readCount: 1000, readLength: 150, mode: "paired" }),
        runFolder: `${demoRoot}/runs/simulate-reads-demo`,
        queuedAt: new Date(simRunAt.getTime() - 60_000),
        startedAt: simRunAt,
        completedAt: new Date(simRunAt.getTime() + 15 * 60_000),
        lastEventAt: new Date(simRunAt.getTime() + 15 * 60_000),
        statusSource: "process",
        results: JSON.stringify({ note: "Demo seeded simulate-reads run." }),
        queueStatus: "COMPLETED",
        queueUpdatedAt: new Date(simRunAt.getTime() + 15 * 60_000),
      },
    });

    const ckRun = await tx.pipelineRun.create({
      data: {
        runNumber: createRunNumber(prefix, "FASTQ-CHECKSUM"),
        pipelineId: "fastq-checksum",
        status: "completed",
        progress: 100,
        currentStep: "Completed",
        orderId: submittedOrder.id,
        userId: facilityAdmin.id,
        inputSampleIds: JSON.stringify(submittedOrder.samples.map((s) => s.id)),
        config: JSON.stringify({}),
        runFolder: `${demoRoot}/runs/fastq-checksum-demo`,
        queuedAt: new Date(ckRunAt.getTime() - 60_000),
        startedAt: ckRunAt,
        completedAt: new Date(ckRunAt.getTime() + 5 * 60_000),
        lastEventAt: new Date(ckRunAt.getTime() + 5 * 60_000),
        statusSource: "process",
        results: JSON.stringify({ note: "Demo seeded fastq-checksum run." }),
        queueStatus: "COMPLETED",
        queueUpdatedAt: new Date(ckRunAt.getTime() + 5 * 60_000),
      },
    });

    const qcRun = await tx.pipelineRun.create({
      data: {
        runNumber: createRunNumber(prefix, "FASTQC"),
        pipelineId: "fastqc",
        status: "completed",
        progress: 100,
        currentStep: "Completed",
        orderId: submittedOrder.id,
        userId: facilityAdmin.id,
        inputSampleIds: JSON.stringify(submittedOrder.samples.map((s) => s.id)),
        config: JSON.stringify({}),
        runFolder: `${demoRoot}/runs/fastqc-demo`,
        queuedAt: new Date(qcRunAt.getTime() - 60_000),
        startedAt: qcRunAt,
        completedAt: new Date(qcRunAt.getTime() + 10 * 60_000),
        lastEventAt: new Date(qcRunAt.getTime() + 10 * 60_000),
        statusSource: "process",
        results: JSON.stringify({ note: "Demo seeded fastqc run." }),
        queueStatus: "COMPLETED",
        queueUpdatedAt: new Date(qcRunAt.getTime() + 10 * 60_000),
      },
    });

    const pipelineSources = JSON.stringify({
      "simulate-reads": simRun.id,
      "fastq-checksum": ckRun.id,
      fastqc: qcRun.id,
    });

    // Create reads for submitted order samples with full pipeline output
    const sampleAliases = ["GR-01", "GR-02", "GR-03"];
    for (let i = 0; i < submittedOrder.samples.length; i++) {
      const s = submittedOrder.samples[i];
      const alias = sampleAliases[i] ?? s.sampleId;
      await tx.read.create({
        data: {
          sampleId: s.id,
          file1: `${demoRoot}/reads/${alias}_R1.fastq.gz`,
          file2: `${demoRoot}/reads/${alias}_R2.fastq.gz`,
          checksum1: `a1b2c3d4e5f6${String(i + 1).padStart(4, "0")}demo1234`,
          checksum2: `f6e5d4c3b2a1${String(i + 1).padStart(4, "0")}demo5678`,
          fastqcReport1: `${demoRoot}/runs/fastqc-demo/fastqc_reports/${alias}_R1_fastqc.html`,
          fastqcReport2: `${demoRoot}/runs/fastqc-demo/fastqc_reports/${alias}_R2_fastqc.html`,
          pipelineRunId: simRun.id,
          pipelineSources,
        },
      });
    }

    const completedOrder = await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 3),
        name: "Surface resistome pilot",
        status: "COMPLETED",
        statusUpdatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        numberOfSamples: 2,
        contactName: "Demo Researcher",
        contactEmail: researcherEmail,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "NextSeq 2000",
        libraryStrategy: "WGS",
        librarySource: "METAGENOMIC",
        userId: researcher.id,
        samples: {
          create: [
            {
              sampleId: createSampleId(prefix, 3, 1),
              sampleAlias: "SR-01",
              sampleTitle: "Surface swab entry rail",
              scientificName: "metagenome",
              taxId: "256318",
              checklistData: JSON.stringify({
                collection_date: "2026-01-19",
                geographic_location: "Germany:Lower Saxony:Braunschweig",
                env_broad_scale: "built environment",
              }),
              customFields: JSON.stringify({
                sample_volume: "35",
                sample_concentration: "15",
              }),
              study: {
                connect: { id: pilotStudy.id },
              },
              reads: {
                create: {
                  file1: `${demoRoot}/surface-resistome/SR-01_R1.fastq.gz`,
                  file2: `${demoRoot}/surface-resistome/SR-01_R2.fastq.gz`,
                },
              },
            },
            {
              sampleId: createSampleId(prefix, 3, 2),
              sampleAlias: "SR-02",
              sampleTitle: "Surface swab door handle",
              scientificName: "metagenome",
              taxId: "256318",
              checklistData: JSON.stringify({
                collection_date: "2026-01-19",
                geographic_location: "Germany:Lower Saxony:Braunschweig",
                env_broad_scale: "built environment",
              }),
              customFields: JSON.stringify({
                sample_volume: "38",
                sample_concentration: "17",
              }),
              study: {
                connect: { id: pilotStudy.id },
              },
              reads: {
                create: {
                  file1: `${demoRoot}/surface-resistome/SR-02_R1.fastq.gz`,
                  file2: `${demoRoot}/surface-resistome/SR-02_R2.fastq.gz`,
                },
              },
            },
          ],
        },
      },
      include: {
        samples: {
          select: {
            id: true,
            sampleId: true,
          },
        },
      },
    });

    await tx.statusNote.create({
      data: {
        noteType: "SAMPLES_SENT",
        content: "Demo samples marked as sent to the institution.",
        orderId: completedOrder.id,
        userId: facilityAdmin.id,
      },
    });

    await tx.statusNote.create({
      data: {
        noteType: "INTERNAL",
        content: `Workspace seeded from demo template v${DEMO_SEED_VERSION}.`,
        orderId: draftOrder.id,
        userId: researcher.id,
      },
    });

    await tx.statusNote.create({
      data: {
        noteType: "INTERNAL",
        content:
          "Facility review completed. Samples and analysis outputs are seeded for the live admin demo.",
        orderId: submittedOrder.id,
        userId: facilityAdmin.id,
      },
    });

    const runQueuedAt = new Date(now.getTime() - 37 * 60 * 60 * 1000);
    const runStartedAt = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    const runCompletedAt = new Date(now.getTime() - 34 * 60 * 60 * 1000);
    const completedSample = completedOrder.samples[0];

    const pipelineRun = await tx.pipelineRun.create({
      data: {
        runNumber: createRunNumber(prefix),
        pipelineId: "mag",
        status: "completed",
        progress: 100,
        currentStep: "Completed",
        studyId: pilotStudy.id,
        userId: facilityAdmin.id,
        inputSampleIds: JSON.stringify(
          completedOrder.samples.map((sample) => sample.id)
        ),
        config: JSON.stringify({
          preset: "demo-seeded",
          note: "Seeded analysis results for the public facility demo.",
        }),
        runFolder: `${demoRoot}/runs/mag-demo`,
        queueJobId: `demo-${prefix.toLowerCase()}`,
        queuedAt: runQueuedAt,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
        lastEventAt: runCompletedAt,
        lastWeblogAt: runCompletedAt,
        lastTraceAt: runCompletedAt,
        statusSource: "process",
        outputTail:
          "Demo MAG pipeline completed successfully.\n2 bins and 1 assembly were registered.",
        results: JSON.stringify({
          note: "Seeded completed run for the public facility demo.",
          assembliesCreated: 1,
          binsCreated: 1,
        }),
        queueStatus: "COMPLETED",
        queueUpdatedAt: runCompletedAt,
      },
    });

    await tx.pipelineRunStep.create({
      data: {
        pipelineRunId: pipelineRun.id,
        stepId: "fastp",
        stepName: "Read QC",
        status: "completed",
        startedAt: runStartedAt,
        completedAt: new Date(runStartedAt.getTime() + 20 * 60 * 1000),
        outputTail: "All reads passed demo QC thresholds.",
      },
    });

    await tx.pipelineRunStep.create({
      data: {
        pipelineRunId: pipelineRun.id,
        stepId: "megahit",
        stepName: "Assembly",
        status: "completed",
        startedAt: new Date(runStartedAt.getTime() + 20 * 60 * 1000),
        completedAt: new Date(runStartedAt.getTime() + 90 * 60 * 1000),
        outputTail: "Assembly completed with seeded demo contigs.",
      },
    });

    await tx.pipelineRunStep.create({
      data: {
        pipelineRunId: pipelineRun.id,
        stepId: "metabat2",
        stepName: "Binning",
        status: "completed",
        startedAt: new Date(runStartedAt.getTime() + 90 * 60 * 1000),
        completedAt: runCompletedAt,
        outputTail: "Binning completed for the seeded demo run.",
      },
    });

    await tx.pipelineRunEvent.create({
      data: {
        pipelineRunId: pipelineRun.id,
        eventType: "workflow_start",
        status: "running",
        source: "process",
        message: "Demo MAG workflow started.",
        occurredAt: runStartedAt,
      },
    });

    await tx.pipelineRunEvent.create({
      data: {
        pipelineRunId: pipelineRun.id,
        eventType: "process_complete",
        processName: "megahit",
        stepId: "megahit",
        status: "completed",
        source: "trace",
        message: "Assembly finished with seeded demo outputs.",
        occurredAt: new Date(runStartedAt.getTime() + 90 * 60 * 1000),
      },
    });

    await tx.pipelineRunEvent.create({
      data: {
        pipelineRunId: pipelineRun.id,
        eventType: "workflow_complete",
        status: "completed",
        source: "process",
        message: "Seeded facility demo run completed successfully.",
        occurredAt: runCompletedAt,
      },
    });

    if (completedSample) {
      await tx.assembly.create({
        data: {
          sampleId: completedSample.id,
          assemblyName: "Seeded MAG Assembly",
          assemblyFile: `${demoRoot}/runs/mag-demo/output/assembly/contigs.fasta`,
          createdByPipelineRunId: pipelineRun.id,
        },
      });

      await tx.bin.create({
        data: {
          sampleId: completedSample.id,
          binName: "Seeded Bin 01",
          binFile: `${demoRoot}/runs/mag-demo/output/bins/bin.001.fa`,
          completeness: 97.8,
          contamination: 2.1,
          createdByPipelineRunId: pipelineRun.id,
        },
      });

      await tx.pipelineArtifact.create({
        data: {
          pipelineRunId: pipelineRun.id,
          studyId: pilotStudy.id,
          sampleId: completedSample.id,
          type: "qc_report",
          name: "MultiQC Report",
          path: `${demoRoot}/runs/mag-demo/output/multiqc_report.html`,
          size: BigInt(245760),
          producedByStepId: "fastp",
          metadata: JSON.stringify({
            seeded: true,
            label: "Demo report",
          }),
        },
      });
    }

    return {
      workspaceId: workspace.id,
      researcherUserId: researcher.id,
      adminUserId: facilityAdmin.id,
    };
  });

  return {
    expiresAt,
    token: rawToken,
    workspaceId: result.workspaceId,
    researcherUserId: result.researcherUserId,
    adminUserId: result.adminUserId,
  };
}

async function findWorkspaceByToken(
  token: string
): Promise<DemoWorkspaceWithUsers | null> {
  const tokenHash = hashDemoToken(token);
  return db.demoWorkspace.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isDemo: true,
        },
      },
      adminUser: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isDemo: true,
        },
      },
    },
  });
}

async function destroyWorkspaceByRecord(
  tx: Prisma.TransactionClient,
  workspace: Pick<DemoWorkspaceRecord, "id" | "userId" | "adminUserId">
): Promise<void> {
  const userIds = [
    workspace.userId,
    ...(workspace.adminUserId ? [workspace.adminUserId] : []),
  ];
  const studies = await tx.study.findMany({
    where: { userId: workspace.userId },
    select: { id: true },
  });
  const studyIds = studies.map((study) => study.id);

  // Find all orders owned by the researcher to clean up dependent records
  const orders = await tx.order.findMany({
    where: { userId: workspace.userId },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  // Find all samples in those orders to clean up reads
  const samples = orderIds.length > 0
    ? await tx.sample.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
    : [];
  const sampleIds = samples.map((s) => s.id);

  // Delete reads linked to demo samples (blocks sample cascade)
  if (sampleIds.length > 0) {
    await tx.read.deleteMany({ where: { sampleId: { in: sampleIds } } });
  }

  await tx.statusNote.deleteMany({ where: { userId: { in: userIds } } });
  await tx.ticketMessage.deleteMany({ where: { userId: { in: userIds } } });
  await tx.ticket.deleteMany({ where: { userId: { in: userIds } } });

  // Delete pipeline runs linked to orders or studies or users
  const pipelineRunWhere: Prisma.PipelineRunWhereInput = {
    OR: [
      { userId: { in: userIds } },
      ...(studyIds.length > 0 ? [{ studyId: { in: studyIds } }] : []),
      ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
    ],
  };
  await tx.pipelineRun.deleteMany({ where: pipelineRunWhere });

  await tx.order.deleteMany({ where: { userId: workspace.userId } });
  await tx.study.deleteMany({ where: { userId: workspace.userId } });
  await tx.demoWorkspace.deleteMany({ where: { id: workspace.id } });
  await tx.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
}

async function destroyWorkspaceByToken(token: string): Promise<boolean> {
  const workspace = await findWorkspaceByToken(token);
  if (!workspace) {
    return false;
  }

  await db.$transaction(async (tx) => {
    await destroyWorkspaceByRecord(tx, workspace);
  });

  return true;
}

/**
 * Last-resort cleanup: delete orphaned demo records by token-derived patterns.
 * This handles the case where the workspace record was deleted but orders/users
 * remain in the database (e.g., from a partial destroy in older code).
 */
async function cleanupOrphanedDemoRecords(token: string): Promise<void> {
  const prefix = token.slice(0, 6).toUpperCase();
  const orderNumberPrefix = `DEMO-${prefix}-`;
  const emailSuffix = "@seqdesk.local";

  await db.$transaction(async (tx) => {
    // Find orphaned orders by order number pattern
    const orphanedOrders = await tx.order.findMany({
      where: { orderNumber: { startsWith: orderNumberPrefix } },
      select: { id: true, userId: true },
    });

    if (orphanedOrders.length > 0) {
      const orderIds = orphanedOrders.map((o) => o.id);
      const userIds = [...new Set(orphanedOrders.map((o) => o.userId))];

      // Clean up samples' reads
      const samples = await tx.sample.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      if (samples.length > 0) {
        await tx.read.deleteMany({ where: { sampleId: { in: samples.map((s) => s.id) } } });
      }

      // Clean up pipeline runs referencing these orders
      await tx.pipelineRun.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.statusNote.deleteMany({ where: { userId: { in: userIds } } });
      await tx.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }

    // Clean up orphaned demo users by email pattern
    await tx.user.deleteMany({
      where: {
        isDemo: true,
        AND: [
          { email: { endsWith: emailSuffix } },
          { email: { contains: token.slice(0, 6) } },
        ],
      },
    });
  });

  console.log(`[Demo Cleanup] Orphan cleanup completed for prefix ${prefix}`);
}

async function refreshWorkspace(workspaceId: string): Promise<Date> {
  const refreshedExpiry = addHours(new Date(), DEMO_SESSION_TTL_HOURS);
  await db.demoWorkspace.update({
    where: { id: workspaceId },
    data: {
      lastSeenAt: new Date(),
      expiresAt: refreshedExpiry,
    },
  });
  return refreshedExpiry;
}

export function getDemoWorkspaceCookieName(): string {
  return DEMO_WORKSPACE_COOKIE;
}

export function getDemoCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: addHours(new Date(), DEMO_SESSION_TTL_HOURS),
  };
}

function shouldUseSecureAuthCookies(): boolean {
  return (
    process.env.NEXTAUTH_URL?.startsWith("https://") ??
    Boolean(process.env.VERCEL)
  );
}

export function getAuthSessionCookieName(): string {
  return shouldUseSecureAuthCookies()
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

export function getAuthSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureAuthCookies(),
    path: "/",
    expires: expiresAt,
  };
}

export async function createDemoSessionToken(
  user: DemoAuthUser
): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured.");
  }

  return encode({
    secret,
    maxAge: DEMO_SESSION_TTL_HOURS * 60 * 60,
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      isDemo: user.isDemo,
      demoExperience: user.demoExperience,
    },
  });
}

export function isDemoSession(
  session: Session | null | undefined
): boolean {
  return Boolean(session?.user?.isDemo);
}

export function getDemoExperience(
  session: Session | null | undefined
): DemoExperience | null {
  if (!isDemoSession(session)) {
    return null;
  }

  return normalizeDemoExperience(session?.user?.demoExperience);
}

export function isResearcherDemoSession(
  session: Session | null | undefined
): boolean {
  return getDemoExperience(session) === "researcher";
}

export function isFacilityDemoSession(
  session: Session | null | undefined
): boolean {
  return getDemoExperience(session) === "facility";
}

export async function authorizeDemoWorkspaceToken(
  token?: string | null,
  demoExperience: DemoExperience = "researcher"
): Promise<DemoAuthUser | null> {
  if (!token || !isPublicDemoEnabled()) {
    return null;
  }

  const workspace = await findWorkspaceByToken(token);
  if (!workspace) {
    return null;
  }

  if (!isWorkspaceReusable(workspace)) {
    await db.$transaction(async (tx) => {
      await destroyWorkspaceByRecord(tx, workspace);
    });
    return null;
  }

  await refreshWorkspace(workspace.id);

  const selectedUser = selectWorkspaceUser(workspace, demoExperience);
  if (!selectedUser) {
    return null;
  }

  return toDemoAuthUser(selectedUser, demoExperience);
}

export async function bootstrapDemoWorkspace(
  token?: string | null,
  demoExperience: DemoExperience = "researcher"
): Promise<DemoBootstrapResult> {
  if (!isPublicDemoEnabled()) {
    throw new Error("Public demo is not enabled.");
  }

  const normalizedToken = token?.trim() || null;

  if (normalizedToken) {
    const existing = await findWorkspaceByToken(normalizedToken);
    if (existing && isWorkspaceReusable(existing)) {
      const refreshedExpiry = await refreshWorkspace(existing.id);
      return {
        created: false,
        expiresAt: refreshedExpiry,
        token: normalizedToken,
        userId: getDemoUserIdForExperience(existing, demoExperience),
        workspaceId: existing.id,
      };
    }

    if (existing) {
      await destroyWorkspaceByToken(normalizedToken);
    }

    try {
      const created = await createDemoWorkspaceInternal(normalizedToken);
      return {
        created: true,
        expiresAt: created.expiresAt,
        token: created.token,
        userId: getDemoUserIdForExperience(created, demoExperience),
        workspaceId: created.workspaceId,
      };
    } catch (error) {
      // Retry once after cleaning up orphaned records by token prefix
      console.warn("[Demo Bootstrap] Create failed, attempting orphan cleanup:", error);
      await destroyWorkspaceByToken(normalizedToken).catch(() => {});
      await cleanupOrphanedDemoRecords(normalizedToken);
      const created = await createDemoWorkspaceInternal(normalizedToken);
      return {
        created: true,
        expiresAt: created.expiresAt,
        token: created.token,
        userId: getDemoUserIdForExperience(created, demoExperience),
        workspaceId: created.workspaceId,
      };
    }
  }

  const created = await createDemoWorkspaceInternal();
  return {
    created: true,
    expiresAt: created.expiresAt,
    token: created.token,
    userId: getDemoUserIdForExperience(created, demoExperience),
    workspaceId: created.workspaceId,
  };
}

export async function resetDemoWorkspace(
  token?: string | null,
  demoExperience: DemoExperience = "researcher"
): Promise<DemoBootstrapResult> {
  if (!isPublicDemoEnabled()) {
    throw new Error("Public demo is not enabled.");
  }

  const normalizedToken = token?.trim() || null;
  if (normalizedToken) {
    await destroyWorkspaceByToken(normalizedToken);
  }

  const created = await createDemoWorkspaceInternal(normalizedToken);
  return {
    created: true,
    expiresAt: created.expiresAt,
    token: created.token,
    userId: getDemoUserIdForExperience(created, demoExperience),
    workspaceId: created.workspaceId,
  };
}

export async function cleanupExpiredDemoWorkspaces(): Promise<{
  deletedWorkspaces: number;
}> {
  const now = new Date();
  const expired = await db.demoWorkspace.findMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { seedVersion: { not: DEMO_SEED_VERSION } },
      ],
    },
    select: {
      id: true,
      userId: true,
      adminUserId: true,
    },
  });

  for (const workspace of expired) {
    await db.$transaction(async (tx) => {
      await destroyWorkspaceByRecord(tx, workspace);
    });
  }

  return {
    deletedWorkspaces: expired.length,
  };
}
