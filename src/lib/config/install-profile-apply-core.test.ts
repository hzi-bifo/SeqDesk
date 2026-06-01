import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOrderForm,
  applySiteProfile,
  normalizeAccessSettings,
  normalizeAccountValidationSettings,
  normalizeAuthSettings,
  normalizeBillingSettings,
  normalizeNotificationManagedSettings,
  normalizeSequencingFilesConfig,
} from "../../../scripts/lib/install-profile-apply-core.mjs";

const MANAGED_KEY = "installProfileManaged";

type SiteSettingsState = Record<string, unknown> | null;

function createPrisma(settings: SiteSettingsState = {}) {
  const state: { siteSettings: SiteSettingsState } = {
    siteSettings: {
      id: "singleton",
      modulesConfig: null,
      extraSettings: "{}",
      ...settings,
    },
  };

  return {
    state,
    siteSettings: {
      findUnique: vi.fn(async () => state.siteSettings),
      upsert: vi.fn(async (args: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        state.siteSettings = {
          ...(state.siteSettings ?? {}),
          ...args.create,
          ...args.update,
        };
        return state.siteSettings;
      }),
    },
  };
}

type OrderFormState = Record<string, unknown> | null;

function createOrderFormPrisma(orderForm: OrderFormState = null) {
  const state: { orderFormConfig: OrderFormState } = { orderFormConfig: orderForm };
  return {
    state,
    orderFormConfig: {
      findUnique: vi.fn(async () => state.orderFormConfig),
      upsert: vi.fn(
        async (args: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
          state.orderFormConfig = {
            ...(state.orderFormConfig ?? {}),
            ...args.create,
            ...args.update,
          };
          return state.orderFormConfig;
        }
      ),
    },
  };
}

function lastOrderFormSchema(prisma: ReturnType<typeof createOrderFormPrisma>) {
  const call = prisma.orderFormConfig.upsert.mock.calls.at(-1);
  expect(call).toBeDefined();
  const args = call?.[0] as { update: Record<string, unknown> };
  return JSON.parse(String(args.update.schema));
}

function lastSiteSettingsWrite(prisma: ReturnType<typeof createPrisma>) {
  const call = prisma.siteSettings.upsert.mock.calls.at(-1);
  expect(call).toBeDefined();
  const args = call?.[0] as { update: Record<string, unknown> };
  const extra = JSON.parse(String(args.update.extraSettings));
  return { update: args.update, extra };
}

describe("install profile applicator core", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00.000Z"));
  });

  it("normalizes safe runtime profile sections and ignores report-only fields", () => {
    expect(
      normalizeSequencingFilesConfig({
        sequencingFiles: {
          allowedExtensions: [" .fastq.gz ", ".fq.gz", ".fq.gz"],
          scanDepth: "4",
          ignorePatterns: [" **/tmp/** "],
          autoAssign: "yes",
          activeWriteMinAgeMs: 0,
          simulationMode: "template",
          simulationTemplateDir: " /data/templates ",
          allowSingleEnd: false,
        },
      })
    ).toEqual({
      allowedExtensions: [".fastq.gz", ".fq.gz"],
      scanDepth: 4,
      ignorePatterns: ["**/tmp/**"],
      autoAssign: true,
      activeWriteMinAgeMs: 0,
      simulationMode: "template",
      simulationTemplateDir: "/data/templates",
    });

    expect(
      normalizeSequencingFilesConfig({
        sequencingFiles: {
          extensions: [" .fastq "],
          scanDepth: 0,
          activeWriteMinAgeMs: -1,
          simulationMode: "invalid",
        },
      })
    ).toEqual({ allowedExtensions: [".fastq"] });

    expect(
      normalizeAccessSettings({
        access: {
          departmentSharing: "on",
          allowDeleteSubmittedOrders: 1,
          allowUserAssemblyDownload: "false",
          orderNotesEnabled: false,
          postSubmissionInstructions: " Submitted. ",
        },
      })
    ).toEqual({
      departmentSharing: true,
      allowDeleteSubmittedOrders: true,
      allowUserAssemblyDownload: false,
      orderNotesEnabled: false,
      postSubmissionInstructions: " Submitted. ",
    });

    expect(
      normalizeAuthSettings({
        auth: {
          allowRegistration: "off",
          requireEmailVerification: true,
          sessionTimeout: 12,
        },
      })
    ).toEqual({ allowRegistration: false });

    expect(
      normalizeNotificationManagedSettings({
        notifications: { inApp: { enabled: "true" } },
      })
    ).toEqual({ inApp: { enabled: true } });

    expect(
      normalizeAccountValidationSettings({
        moduleSettings: {
          "account-validation": {
            allowedDomains: [" EXAMPLE.ORG ", "localhost", "example.org"],
            enforceValidation: "yes",
          },
        },
      })
    ).toEqual({
      allowedDomains: ["example.org"],
      enforceValidation: true,
    });

    expect(
      normalizeBillingSettings({
        moduleSettings: {
          "billing-info": {
            pspEnabled: true,
            pspPrefixRange: { min: 2, max: "3" },
            pspMainDigits: "6",
            pspSuffixRange: { min: 1, max: 2 },
            pspExample: "12-123456-01",
            costCenterEnabled: "false",
            costCenterPattern: "^[A-Z0-9-]+$",
            costCenterExample: "HZI-001",
          },
        },
      })
    ).toEqual({
      pspEnabled: true,
      pspPrefixRange: { min: 2, max: 3 },
      pspMainDigits: 6,
      pspSuffixRange: { min: 1, max: 2 },
      pspExample: "12-123456-01",
      costCenterEnabled: false,
      costCenterPattern: "^[A-Z0-9-]+$",
      costCenterExample: "HZI-001",
    });
  });

  it("applies safe DB-backed runtime settings while preserving local settings", async () => {
    const prisma = createPrisma({
      modulesConfig: JSON.stringify({ modules: { "account-validation": false } }),
      extraSettings: JSON.stringify({
        notifications: {
          enabled: true,
          provider: "seqdesk-relay",
          events: { order: { submitted: true } },
        },
        telemetry: { enabled: true },
        minknowStream: { enabled: true },
        localFlag: "keep",
      }),
      postSubmissionInstructions: "Old instructions",
    });

    await applySiteProfile(prisma, {
      id: "dev",
      version: "1.0.0",
      modules: {
        "account-validation": true,
        "billing-info": true,
      },
      sequencingFiles: {
        allowedExtensions: [".fastq.gz", ".fq.gz"],
        scanDepth: 4,
        ignorePatterns: ["**/tmp/**"],
        autoAssign: true,
        activeWriteMinAgeMs: 5000,
        simulationMode: "template",
        simulationTemplateDir: "/data/templates",
      },
      access: {
        departmentSharing: true,
        allowDeleteSubmittedOrders: true,
        allowUserAssemblyDownload: true,
        orderNotesEnabled: false,
        postSubmissionInstructions: "New instructions",
      },
      auth: {
        allowRegistration: false,
        requireEmailVerification: true,
        sessionTimeout: 4,
      },
      notifications: {
        inApp: { enabled: false },
      },
      moduleSettings: {
        "account-validation": {
          allowedDomains: ["example.org"],
          enforceValidation: true,
        },
        "billing-info": {
          pspEnabled: true,
          pspMainDigits: 6,
          costCenterEnabled: false,
        },
      },
    });

    const { update, extra } = lastSiteSettingsWrite(prisma);
    const modulesConfig = JSON.parse(String(update.modulesConfig));

    expect(modulesConfig.modules).toMatchObject({
      "account-validation": true,
      "billing-info": true,
    });
    expect(update.postSubmissionInstructions).toBe("New instructions");
    expect(extra.sequencingFiles).toEqual({
      allowedExtensions: [".fastq.gz", ".fq.gz"],
      scanDepth: 4,
      ignorePatterns: ["**/tmp/**"],
      autoAssign: true,
      activeWriteMinAgeMs: 5000,
      simulationMode: "template",
      simulationTemplateDir: "/data/templates",
    });
    expect(extra).toMatchObject({
      departmentSharing: true,
      allowDeleteSubmittedOrders: true,
      allowUserAssemblyDownload: true,
      orderNotesEnabled: false,
      auth: { allowRegistration: false },
      telemetry: { enabled: true },
      minknowStream: { enabled: true },
      localFlag: "keep",
    });
    expect(extra.notifications).toMatchObject({
      enabled: true,
      provider: "seqdesk-relay",
      events: { order: { submitted: true } },
      inApp: { enabled: false },
    });
    expect(JSON.parse(extra.accountValidationSettings)).toEqual({
      allowedDomains: ["example.org"],
      enforceValidation: true,
    });
    expect(JSON.parse(extra.billingSettings)).toEqual({
      pspEnabled: true,
      pspMainDigits: 6,
      costCenterEnabled: false,
    });
    expect(extra[MANAGED_KEY]).toMatchObject({
      sequencingFilesKeys: [
        "activeWriteMinAgeMs",
        "allowedExtensions",
        "autoAssign",
        "ignorePatterns",
        "scanDepth",
        "simulationMode",
        "simulationTemplateDir",
      ],
      accessKeys: [
        "allowDeleteSubmittedOrders",
        "allowUserAssemblyDownload",
        "departmentSharing",
        "orderNotesEnabled",
        "postSubmissionInstructions",
      ],
      authKeys: ["allowRegistration"],
      notificationKeys: ["inApp"],
      moduleSettings: {
        "account-validation": ["allowedDomains", "enforceValidation"],
        "billing-info": ["costCenterEnabled", "pspEnabled", "pspMainDigits"],
      },
    });
  });

  it("prunes only previously profile-managed values on later reloads", async () => {
    const prisma = createPrisma();
    await applySiteProfile(prisma, {
      id: "dev",
      version: "1",
      sequencingFiles: {
        allowedExtensions: [".fq"],
        autoAssign: true,
      },
      access: {
        departmentSharing: true,
        postSubmissionInstructions: "Managed instructions",
      },
      auth: { allowRegistration: false },
      notifications: { inApp: { enabled: false } },
      moduleSettings: {
        "account-validation": {
          allowedDomains: ["example.org"],
          enforceValidation: true,
        },
        "billing-info": {
          pspEnabled: true,
          costCenterEnabled: true,
        },
      },
    });

    const firstExtra = JSON.parse(String(prisma.state.siteSettings?.extraSettings));
    firstExtra.sequencingFiles.localOnly = true;
    firstExtra.notifications.enabled = true;
    firstExtra.notifications.provider = "seqdesk-relay";
    firstExtra.notifications.events = { order: { submitted: true } };
    firstExtra.auth.localMode = "keep";
    firstExtra.accountValidationSettings = JSON.stringify({
      ...JSON.parse(firstExtra.accountValidationSettings),
      localNote: "keep",
    });
    firstExtra.billingSettings = JSON.stringify({
      ...JSON.parse(firstExtra.billingSettings),
      localBudget: "keep",
    });
    firstExtra.telemetry = { enabled: true };
    firstExtra.minknowStream = { enabled: true };
    firstExtra.localFlag = "keep";
    prisma.state.siteSettings = {
      ...prisma.state.siteSettings,
      extraSettings: JSON.stringify(firstExtra),
      postSubmissionInstructions: "Managed instructions",
    };

    await applySiteProfile(prisma, {
      id: "dev",
      version: "2",
    });

    const { update, extra } = lastSiteSettingsWrite(prisma);

    expect(update.postSubmissionInstructions).toBeNull();
    expect(extra.sequencingFiles).toEqual({ localOnly: true });
    expect(extra.notifications).toEqual({
      enabled: true,
      provider: "seqdesk-relay",
      events: { order: { submitted: true } },
    });
    expect(extra.auth).toEqual({ localMode: "keep" });
    expect(extra).toMatchObject({
      telemetry: { enabled: true },
      minknowStream: { enabled: true },
      localFlag: "keep",
    });
    expect(extra.departmentSharing).toBeUndefined();
    expect(JSON.parse(extra.accountValidationSettings)).toEqual({ localNote: "keep" });
    expect(JSON.parse(extra.billingSettings)).toEqual({ localBudget: "keep" });
    expect(extra[MANAGED_KEY]).toMatchObject({
      sequencingFilesKeys: [],
      accessKeys: [],
      authKeys: [],
      notificationKeys: [],
      moduleSettings: {
        "account-validation": [],
        "billing-info": [],
      },
    });
  });

  it("applies an order-form profile that ships only MIxS checklists", async () => {
    const prisma = createOrderFormPrisma();

    await expect(
      applyOrderForm(prisma, {
        id: "dev",
        version: "1",
        forms: {
          order: {
            enabledMixsChecklists: ["MIMS.me"],
          },
        },
      })
    ).resolves.toBe(true);

    const schema = lastOrderFormSchema(prisma);
    expect(schema.enabledMixsChecklists).toEqual(["MIMS.me"]);
    expect(schema.installProfileManaged.orderFormEnabledMixsChecklists).toEqual(["MIMS.me"]);
  });

  it("prunes a previously profile-managed checklist on a later no-forms reload", async () => {
    const prisma = createOrderFormPrisma();

    await applyOrderForm(prisma, {
      id: "dev",
      version: "1",
      forms: {
        order: {
          enabledMixsChecklists: ["MIMS.me"],
        },
      },
    });

    const firstSchema = JSON.parse(String(prisma.state.orderFormConfig?.schema));
    firstSchema.enabledMixsChecklists.push("local-checklist");
    prisma.state.orderFormConfig = {
      ...prisma.state.orderFormConfig,
      schema: JSON.stringify(firstSchema),
    };

    await expect(
      applyOrderForm(prisma, {
        id: "dev",
        version: "2",
      })
    ).resolves.toBe(true);

    const schema = lastOrderFormSchema(prisma);
    expect(schema.enabledMixsChecklists).toEqual(["local-checklist"]);
    expect(schema.installProfileManaged.orderFormEnabledMixsChecklists).toEqual([]);
  });

  it("recovers from malformed stored extraSettings", async () => {
    const prisma = createPrisma({
      extraSettings: "{not-json",
    });

    await expect(
      applySiteProfile(prisma, {
        id: "dev",
        sequencingFiles: { scanDepth: 3 },
      })
    ).resolves.toBe(true);

    const { extra } = lastSiteSettingsWrite(prisma);
    expect(extra.sequencingFiles).toEqual({ scanDepth: 3 });
  });
});
