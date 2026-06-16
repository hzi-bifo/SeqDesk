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
import { decryptSecret, isEncrypted } from "../../../scripts/lib/secret-store.mjs";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-install-profile-core";

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

  it("applies ENA credentials from canonical and Webin alias profile keys", async () => {
    const prisma = createPrisma({
      extraSettings: JSON.stringify({
        ena: { centerName: "OLD" },
      }),
    });

    await applySiteProfile(prisma, {
      id: "dev",
      version: "1.0.0",
      ena: {
        testMode: "false",
        webinUsername: " Webin-12345 ",
        webinPassword: " ena-secret ",
        brokerAccount: "true",
        centerName: " HZI-BIFO ",
      },
    });

    const { update, extra } = lastSiteSettingsWrite(prisma);

    expect(update.enaUsername).toBe("Webin-12345");
    expect(update.enaTestMode).toBe(false);
    expect(isEncrypted(update.enaPassword as string)).toBe(true);
    expect(decryptSecret(update.enaPassword as string)).toBe("ena-secret");
    expect(extra.ena).toEqual({
      centerName: "HZI-BIFO",
      brokerAccount: true,
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

  it("F14: applies order + study + runAssignment from ONE forms source to their existing read stores", async () => {
    // The "one settings.json" source: a SINGLE profile carries all three sub-forms under one
    // `forms` key. Per the locked Phase 4 design, that one source PROJECTS onto the EXISTING
    // read stores — order -> OrderFormConfig.schema (the app's order-form read path), study and
    // runAssignment -> SiteSettings.extraSettings. Order must NOT be relocated into extraSettings.
    const profile = {
      id: "dev",
      version: "1",
      forms: {
        order: {
          fields: [{ id: "order-f1", label: "Order Field 1", groupId: "g" }],
          groups: [],
          defaultsVersion: 4,
        },
        study: { fields: [{ id: "study-f1", label: "Study Field 1", groupId: "g" }], groups: [] },
        runAssignment: {
          fields: [{ id: "run-f1", label: "Run Field 1", groupId: "g" }],
          groups: [],
        },
      },
    };

    // Order is projected to OrderFormConfig.schema (the dedicated store the in-app reader uses).
    const orderPrisma = createOrderFormPrisma();
    await applyOrderForm(orderPrisma, profile);
    const orderSchema = lastOrderFormSchema(orderPrisma);
    expect(orderSchema.fields.map((f: { id: string }) => f.id)).toContain("order-f1");
    // The order defaults version is stamped under the key the in-app reader consults so a
    // re-apply is a no-op (no module-default re-injection).
    expect(orderSchema.moduleDefaultsVersion).toBe(4);

    // Study + runAssignment are projected to SiteSettings.extraSettings, from the SAME source.
    const sitePrisma = createPrisma();
    await applySiteProfile(sitePrisma, profile);
    const { extra } = lastSiteSettingsWrite(sitePrisma);

    expect(extra.studyFormFields.map((f: { id: string }) => f.id)).toContain("study-f1");
    expect(
      (extra.sequencingRunSampleFormFields as { id: string }[]).map((f) => f.id)
    ).toContain("run-f1");

    // Order must KEEP landing in OrderFormConfig — it must NOT be mirrored into extraSettings.
    expect(extra.orderFormFields).toBeUndefined();
  });

  it("stamps the order-form defaults version under the same key the in-app reader consults", async () => {
    const prisma = createOrderFormPrisma();

    await applyOrderForm(prisma, {
      id: "dev",
      version: "1",
      forms: {
        order: {
          defaultsVersion: 4,
          enabledMixsChecklists: ["MIMS.me"],
        },
      },
    });

    const schema = lastOrderFormSchema(prisma);

    // The in-app GET (form-config/route.ts:60) and apply-form-configs.mjs:203 gate/stamp on
    // `moduleDefaultsVersion`. The install path must use the same key so a re-apply is a no-op
    // instead of re-injecting module defaults.
    expect(schema.moduleDefaultsVersion).toBe(4); // FAILS today: undefined

    // Guard against the divergence regressing: the version must NOT live only under the
    // orphaned key that zero readers consult.
    expect(schema.installProfileDefaultsVersion).toBeUndefined();
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
