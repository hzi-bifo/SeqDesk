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

type DemoBootstrapResult = {
  created: boolean;
  expiresAt: Date;
  token: string;
  userId: string;
  workspaceId: string;
};

type DemoWorkspaceRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  seedVersion: number;
  lastSeenAt: Date;
  expiresAt: Date;
};

type DemoAuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isDemo: boolean;
};

type DemoWorkspaceWithUser = DemoWorkspaceRecord & {
  user: DemoAuthUser;
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

function createDemoEmail(token: string): string {
  return `demo-${token.slice(0, 12)}@seqdesk.local`;
}

function createOrderNumber(prefix: string, index: number): string {
  return `DEMO-${prefix}-${String(index).padStart(3, "0")}`;
}

function createSampleId(prefix: string, orderIndex: number, sampleIndex: number): string {
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

async function createDemoWorkspaceInternal(): Promise<DemoBootstrapResult> {
  await ensureDemoBaseState();

  const now = new Date();
  const expiresAt = addHours(now, DEMO_SESSION_TTL_HOURS);
  const rawToken = createDemoToken();
  const tokenHash = hashDemoToken(rawToken);
  const prefix = rawToken.slice(0, 6).toUpperCase();
  const email = createDemoEmail(rawToken);
  const passwordHash = await hash(rawToken, 10);

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        password: passwordHash,
        firstName: "Demo",
        lastName: "User",
        role: "RESEARCHER",
        isDemo: true,
        institution: "SeqDesk Demo Workspace",
        researcherRole: "POSTDOC",
      },
    });

    const workspace = await tx.demoWorkspace.create({
      data: {
        tokenHash,
        userId: user.id,
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
        userId: user.id,
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
        userId: user.id,
      },
    });

    const draftOrder = await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 1),
        name: "Draft host-associated screening batch",
        status: "DRAFT",
        numberOfSamples: 2,
        contactName: "Demo User",
        contactEmail: email,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "MiSeq",
        libraryStrategy: "AMPLICON",
        librarySource: "METAGENOMIC",
        customFields: JSON.stringify({
          _projects: "Screening batch\nValidation panel",
        }),
        userId: user.id,
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

    await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 2),
        name: "Gut recovery metagenome cohort",
        status: "SUBMITTED",
        statusUpdatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        numberOfSamples: 3,
        contactName: "Demo User",
        contactEmail: email,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "NovaSeq 6000",
        libraryStrategy: "WGS",
        librarySource: "METAGENOMIC",
        customFields: JSON.stringify({
          _projects: "Gut recovery cohort\nTimepoint atlas",
        }),
        userId: user.id,
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
    });

    const completedOrder = await tx.order.create({
      data: {
        orderNumber: createOrderNumber(prefix, 3),
        name: "Surface resistome pilot",
        status: "COMPLETED",
        statusUpdatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        numberOfSamples: 2,
        contactName: "Demo User",
        contactEmail: email,
        billingAddress: "SeqDesk Demo Workspace",
        platform: "ILLUMINA",
        instrumentModel: "NextSeq 2000",
        libraryStrategy: "WGS",
        librarySource: "METAGENOMIC",
        userId: user.id,
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
                  file1: `demo/${prefix.toLowerCase()}/surface-resistome/SR-01_R1.fastq.gz`,
                  file2: `demo/${prefix.toLowerCase()}/surface-resistome/SR-01_R2.fastq.gz`,
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
                  file1: `demo/${prefix.toLowerCase()}/surface-resistome/SR-02_R1.fastq.gz`,
                  file2: `demo/${prefix.toLowerCase()}/surface-resistome/SR-02_R2.fastq.gz`,
                },
              },
            },
          ],
        },
      },
    });

    await tx.statusNote.create({
      data: {
        noteType: "SAMPLES_SENT",
        content: "Demo samples marked as sent to the institution.",
        orderId: completedOrder.id,
        userId: user.id,
      },
    });

    await tx.statusNote.create({
      data: {
        noteType: "INTERNAL",
        content: `Workspace seeded from demo template v${DEMO_SEED_VERSION}.`,
        orderId: draftOrder.id,
        userId: user.id,
      },
    });

    return {
      userId: user.id,
      workspaceId: workspace.id,
    };
  });

  return {
    created: true,
    expiresAt,
    token: rawToken,
    userId: result.userId,
    workspaceId: result.workspaceId,
  };
}

async function findWorkspaceByToken(
  token: string
): Promise<DemoWorkspaceWithUser | null> {
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
    },
  });
}

async function destroyWorkspaceByRecord(
  tx: Prisma.TransactionClient,
  workspace: Pick<DemoWorkspaceRecord, "id" | "userId">
): Promise<void> {
  await tx.statusNote.deleteMany({ where: { userId: workspace.userId } });
  await tx.ticketMessage.deleteMany({ where: { userId: workspace.userId } });
  await tx.pipelineRun.deleteMany({ where: { userId: workspace.userId } });
  await tx.ticket.deleteMany({ where: { userId: workspace.userId } });
  await tx.order.deleteMany({ where: { userId: workspace.userId } });
  await tx.study.deleteMany({ where: { userId: workspace.userId } });
  await tx.demoWorkspace.deleteMany({ where: { id: workspace.id } });
  await tx.user.deleteMany({ where: { id: workspace.userId } });
}

async function destroyWorkspaceByUserId(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string
): Promise<void> {
  await destroyWorkspaceByRecord(tx, { id: workspaceId, userId });
}

async function destroyWorkspaceByToken(token: string): Promise<boolean> {
  const workspace = await findWorkspaceByToken(token);
  if (!workspace) {
    return false;
  }

  await db.$transaction(async (tx) => {
    await destroyWorkspaceByUserId(tx, workspace.userId, workspace.id);
  });

  return true;
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

export async function createDemoSessionToken(user: DemoAuthUser): Promise<string> {
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
    },
  });
}

export function isDemoSession(
  session: Session | null | undefined
): boolean {
  return Boolean(session?.user?.isDemo);
}

export async function authorizeDemoWorkspaceToken(
  token?: string | null
): Promise<DemoAuthUser | null> {
  if (!token || !isPublicDemoEnabled()) {
    return null;
  }

  const workspace = await findWorkspaceByToken(token);
  if (!workspace) {
    return null;
  }

  if (
    workspace.seedVersion !== DEMO_SEED_VERSION ||
    workspace.expiresAt.getTime() <= Date.now()
  ) {
    await db.$transaction(async (tx) => {
      await destroyWorkspaceByRecord(tx, workspace);
    });
    return null;
  }

  await db.demoWorkspace.update({
    where: { id: workspace.id },
    data: {
      lastSeenAt: new Date(),
      expiresAt: addHours(new Date(), DEMO_SESSION_TTL_HOURS),
    },
  });

  return workspace.user;
}

export async function bootstrapDemoWorkspace(
  token?: string | null
): Promise<DemoBootstrapResult> {
  if (!isPublicDemoEnabled()) {
    throw new Error("Public demo is not enabled.");
  }

  if (token) {
    const existing = await findWorkspaceByToken(token);
    if (
      existing &&
      existing.seedVersion === DEMO_SEED_VERSION &&
      existing.expiresAt.getTime() > Date.now()
    ) {
      const refreshedExpiry = addHours(new Date(), DEMO_SESSION_TTL_HOURS);
      await db.demoWorkspace.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          expiresAt: refreshedExpiry,
        },
      });

      return {
        created: false,
        expiresAt: refreshedExpiry,
        token,
        userId: existing.userId,
        workspaceId: existing.id,
      };
    }

    if (existing) {
      await destroyWorkspaceByToken(token);
    }
  }

  return createDemoWorkspaceInternal();
}

export async function resetDemoWorkspace(
  token?: string | null
): Promise<DemoBootstrapResult> {
  if (!isPublicDemoEnabled()) {
    throw new Error("Public demo is not enabled.");
  }

  if (token) {
    await destroyWorkspaceByToken(token);
  }

  return createDemoWorkspaceInternal();
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
