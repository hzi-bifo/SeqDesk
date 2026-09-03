import { z } from "zod";

import { validateDeploymentProfileCompatibility } from "@/lib/deployment-profile/compatibility";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile/definitions";

export const INSTALL_PLAN_SCHEMA_VERSION = 1 as const;

const sourceSchema = z.enum(["default", "answer", "cli", "config", "hosted"]);
const protectedReferenceSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("://") &&
      !value.toLowerCase().includes("password=") &&
      !value.includes("@"),
    "Install plans contain protected references, never secret values or connection URLs."
  );

export const installPlanSchema = z
  .object({
    schemaVersion: z.literal(INSTALL_PLAN_SCHEMA_VERSION),
    operation: z.enum(["install", "reconfigure", "update"]),
    target: z
      .object({
        directory: z.string().min(1),
        classification: z.enum([
          "new",
          "empty-directory",
          "existing-seqdesk",
          "partial-seqdesk",
          "unrelated-existing",
        ]),
      })
      .strict(),
    release: z
      .object({
        version: z.string().min(1),
        source: z.string().url(),
        checksum: z.string().min(1).optional(),
        estimatedDownloadBytes: z.number().int().positive().optional(),
      })
      .strict(),
    preflight: z
      .object({
        targetWritable: z.boolean(),
        installationAvailableBytes: z.number().int().nonnegative().optional(),
        installationRequiredBytes: z.number().int().positive(),
        storageAvailableBytes: z
          .object({
            managedData: z.number().int().nonnegative().optional(),
            pipelineRuns: z.number().int().nonnegative().optional(),
            pipelineCache: z.number().int().nonnegative().optional(),
          })
          .strict(),
      })
      .strict(),
    deployment: z
      .object({
        profile: z.enum(["sequencing-center", "shared-lab", "research-workbench"]),
        featureModules: z.record(z.string(), z.boolean()).default({}),
      })
      .strict(),
    access: z
      .object({
        audience: z.enum(["local", "team-server", "advanced"]),
        browserUrl: z.string().url(),
        bindHost: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        localHealthUrl: z.string().url(),
      })
      .strict(),
    database: z
      .object({
        mode: z.enum(["local", "existing"]),
        runtimeUrlRef: protectedReferenceSchema,
        directUrlRef: protectedReferenceSchema.optional(),
      })
      .strict(),
    storage: z
      .object({
        managedDataRoot: z.string().min(1).optional(),
        stagingRoot: z.string().min(1).optional(),
        runRoot: z.string().min(1).optional(),
        cacheRoot: z.string().min(1).optional(),
      })
      .strict(),
    execution: z
      .object({
        prepareNow: z.boolean(),
        executor: z.enum(["local", "slurm"]).optional(),
        starterPackages: z.array(z.string().min(1)),
        runSmokeTest: z.boolean(),
        runtimeDownload: z
          .object({
            status: z.enum(["not-required", "resolved-at-apply", "estimated"]),
            estimatedBytes: z.number().int().positive().optional(),
          })
          .strict(),
      })
      .strict(),
    service: z
      .object({
        manager: z.enum(["pm2", "manual"]),
        startNow: z.boolean(),
        startOnBootRequested: z.boolean(),
      })
      .strict(),
    enrollment: z
      .object({
        policy: z.enum(["invite-only", "self-registration"]),
        allowedDomains: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    bootstrap: z
      .object({
        adminEmail: z.string().email(),
        adminName: z.string(),
        passwordRef: protectedReferenceSchema,
      })
      .strict(),
    optional: z
      .object({
        exampleData: z.boolean(),
        telemetry: z.boolean(),
      })
      .strict(),
    sources: z.record(z.string().min(1), sourceSchema),
    lockedPaths: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((plan, context) => {
    const profile = getDeploymentProfileDefinition(plan.deployment.profile);
    const compatibilityIssues = validateDeploymentProfileCompatibility(profile, {
      pipelinesEnabled: plan.execution.prepareNow,
      featureModules: plan.deployment.featureModules,
    });
    for (const issue of compatibilityIssues) {
      if (issue.severity !== "error") continue;
      context.addIssue({
        code: "custom",
        path: issue.moduleId
          ? ["deployment", "featureModules", issue.moduleId]
          : ["deployment", "profile"],
        message: issue.message,
      });
    }

    const browserUrl = new URL(plan.access.browserUrl);
    const localHostname =
      browserUrl.hostname === "localhost" ||
      browserUrl.hostname.endsWith(".localhost") ||
      browserUrl.hostname === "127.0.0.1" ||
      browserUrl.hostname === "[::1]" ||
      browserUrl.hostname === "::1";
    const loopbackBind = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      plan.access.bindHost
    );

    if (plan.access.audience === "local" && (!localHostname || !loopbackBind)) {
      context.addIssue({
        code: "custom",
        path: ["access"],
        message: "Local access requires a loopback listener and localhost browser URL.",
      });
    }
    if (
      plan.access.audience === "team-server" &&
      (browserUrl.protocol !== "https:" || localHostname)
    ) {
      context.addIssue({
        code: "custom",
        path: ["access", "browserUrl"],
        message: "Team-server access requires a non-local HTTPS browser URL.",
      });
    }
    if (plan.execution.prepareNow !== Boolean(plan.execution.executor)) {
      context.addIssue({
        code: "custom",
        path: ["execution", "executor"],
        message: "An executor is required exactly when workflow execution is prepared.",
      });
    }
    if (
      (plan.execution.runtimeDownload.status === "estimated") !==
      Boolean(plan.execution.runtimeDownload.estimatedBytes)
    ) {
      context.addIssue({
        code: "custom",
        path: ["execution", "runtimeDownload"],
        message: "An estimated runtime download must include its estimated byte size.",
      });
    }
    if (
      (plan.service.manager === "manual" &&
        (plan.service.startNow || plan.service.startOnBootRequested)) ||
      (plan.service.manager === "pm2" && !plan.service.startNow)
    ) {
      context.addIssue({
        code: "custom",
        path: ["service"],
        message: "The selected service manager conflicts with its start behavior.",
      });
    }
  });

export type InstallPlan = z.infer<typeof installPlanSchema>;

export function parseInstallPlan(input: unknown): InstallPlan {
  return installPlanSchema.parse(input);
}
