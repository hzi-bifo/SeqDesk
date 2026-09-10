import { getDeploymentProfileDefinition, type DeploymentProfileId } from "@/lib/deployment-profile";
import { isModuleEnabled, parseModulesConfig } from "@/lib/modules/form-integration";
import { importModuleCatalog } from "@/lib/modules/import-catalog";

export const ONBOARDING_SCHEMA_VERSION = 1 as const;

export const ONBOARDING_COMPLETION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "configure-sequencers": ["configure-shared-instruments"],
  "review-analysis-pipelines": ["review-shared-pipelines", "review-workbench-pipelines"],
};

export const ONBOARDING_SECTIONS = {
  essentials: { label: "Installation essentials", description: "Storage, access and responsibilities shared by every SeqDesk installation." },
  facility: { label: "Facility sequencing", description: "Shown because sequencing management is enabled." },
  imports: { label: "Data imports", description: "Prepare the enabled import modules for your team." },
  pipelines: { label: "Pipelines", description: "Check the execution service before running workflows." },
  reports: { label: "Reports & analysis", description: "Use existing metadata and pipeline results in reports." },
} as const;

export type OnboardingCapabilities = {
  facilityEnabled: boolean;
  importModules: ReadonlyArray<{ id: string; name: string }>;
  pipelinesEnabled: boolean;
  reportsEnabled: boolean;
};

/** Resolve the same effective toggles used by the application, including global disable. */
export function resolveOnboardingCapabilities(args: {
  profile: DeploymentProfileId;
  modulesConfig: string | null;
  pipelinesEnabled: boolean;
}): OnboardingCapabilities {
  const modules = parseModulesConfig(args.modulesConfig, getDeploymentProfileDefinition(args.profile));
  return {
    facilityEnabled: isModuleEnabled(modules, "sequencing-management"),
    importModules: importModuleCatalog.filter(module => isModuleEnabled(modules, module.id)),
    // Workflow execution is configured independently of the feature-module switch.
    pipelinesEnabled: args.pipelinesEnabled,
    reportsEnabled: isModuleEnabled(modules, "explore"),
  };
}

export type OnboardingItem = {
  id: string;
  section?: keyof typeof ONBOARDING_SECTIONS;
  requirement: "required" | "recommended";
  /** Omitted items are deliberate human confirmations. */
  completionMode?: "automatic";
  label: string;
  description: string;
  href?: string;
  actionLabel?: string;
};

const COMMON_ITEMS: readonly OnboardingItem[] = [
  {
    id: "confirm-profile-and-identity", section: "essentials", requirement: "recommended",
    label: "Confirm installation identity",
    description: "Review the installation name and contact details shown to your team. Installation-managed values may need to be changed by your server operator.",
    href: "/admin/settings/system", actionLabel: "Review identity",
  },
  {
    id: "verify-storage", section: "essentials", requirement: "required", completionMode: "automatic",
    label: "Verify managed storage",
    description: "SeqDesk checks that the managed-data location exists and can safely create and remove files. This does not verify your backups.",
    href: "/admin/data-storage", actionLabel: "Check storage",
  },
  {
    id: "acknowledge-backups", section: "essentials", requirement: "recommended",
    label: "Document backup responsibility",
    description: "Record who backs up PostgreSQL and scientific data, how often, and how a restore is tested.",
  },
  {
    id: "review-members-and-enrollment", section: "essentials", requirement: "recommended",
    label: "Review members and access",
    description: "Invite the people who need access, choose administrators and review registration and sharing rules.",
    href: "/admin/users", actionLabel: "Manage members",
  },
  {
    id: "review-modules-and-secrets", section: "essentials", requirement: "recommended",
    label: "Review modules and credentials",
    description: "Enable the features the team needs. Configure service credentials only where the selected module requires them.",
    href: "/admin/modules", actionLabel: "Review modules",
  },
  {
    id: "document-retention-and-quotas", section: "essentials", requirement: "recommended",
    label: "Agree on data retention and storage limits",
    description: "Document how long raw data and results are kept and who can remove them. A checklist confirmation does not enforce quotas or delete files.",
    href: "/admin/data-storage", actionLabel: "Review storage",
  },
];

const FACILITY_ITEMS: readonly OnboardingItem[] = [
  {
    id: "configure-intake", section: "facility", requirement: "recommended",
    label: "Configure sequencing intake",
    description: "Review the request form, sample metadata and facility handoff fields.",
    href: "/admin/form-builder", actionLabel: "Configure intake",
  },
  {
    id: "configure-sequencers", section: "facility", requirement: "recommended",
    label: "Configure sequencing technology",
    description: "Add the instruments and sequencing technologies the facility or lab operates.",
    href: "/admin/sequencing-tech", actionLabel: "Configure instruments",
  },
  {
    id: "configure-delivery-and-publishing", section: "facility", requirement: "recommended",
    label: "Review delivery and archive publishing",
    description: "Confirm how results are delivered. Configure ENA credentials only if you submit data to the archive; downloading public reads does not require submission credentials.",
    href: "/admin/ena", actionLabel: "Review publishing",
  },
  {
    id: "test-center-journey", section: "facility", requirement: "recommended",
    label: "Try a sequencing request",
    description: "Create a small request, receive it as facility staff and verify the delivery path.",
    href: "/orders/new", actionLabel: "Create test request",
  },
];

export function getOnboardingItems(
  profile: DeploymentProfileId,
  capabilities: OnboardingCapabilities = resolveOnboardingCapabilities({
    profile, modulesConfig: null, pipelinesEnabled: false,
  }),
): OnboardingItem[] {
  const items = [...COMMON_ITEMS];
  if (capabilities.facilityEnabled) items.push(...FACILITY_ITEMS);
  if (capabilities.importModules.length) items.push(
    {
      id: "confirm-import-policy", section: "imports", requirement: "recommended",
      label: "Review enabled data sources",
      description: `Enabled modules: ${capabilities.importModules.map(module => module.name).join(", ")}. Review supported raw reads, source metadata and storage requirements before importing.`,
      href: "/admin/modules", actionLabel: "Review import modules",
    },
    {
      id: "test-import-journey", section: "imports", requirement: "recommended",
      label: "Try a small data import",
      description: "Name a sequencing-data collection, choose an import module and import a small dataset. Check its files and source metadata; linking it to a study can wait.",
      href: "/orders/import", actionLabel: "Open import modules",
    },
  );
  if (capabilities.pipelinesEnabled) items.push(
    {
      id: "verify-workflow-runtime", section: "pipelines", requirement: "required", completionMode: "automatic",
      label: "Verify the workflow runtime",
      description: "SeqDesk checks the configured execution location, writable run directory, Conda environment, Java and Nextflow. Individual pipelines may still need additional tools or databases.",
      href: "/admin/pipeline-runtime", actionLabel: "Check runtime",
    },
    {
      id: "review-analysis-pipelines", section: "pipelines", requirement: "recommended",
      label: "Review pipelines and their requirements",
      description: "Enable the workflows your team needs and review each pipeline’s prerequisites. Enabling a pipeline is not confirmation that its databases are installed.",
      href: "/admin/settings/pipelines", actionLabel: "Review pipelines",
    },
  );
  if (capabilities.reportsEnabled) items.push({
    id: "review-report-analysis", section: "reports", requirement: "recommended",
    label: "Review report analysis environments",
    description: "Reports can use saved metadata and pipeline tables without running a workflow. Configure an analysis environment only if your team will run report analyses.",
    href: "/admin/settings/analysis", actionLabel: "Review environments",
  });
  return items;
}
