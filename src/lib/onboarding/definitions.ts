import type { DeploymentProfileId } from "@/lib/deployment-profile";

export const ONBOARDING_SCHEMA_VERSION = 1 as const;

export type OnboardingItem = {
  id: string;
  label: string;
  description: string;
  href?: string;
  actionLabel?: string;
};

const COMMON_ITEMS: readonly OnboardingItem[] = [
  {
    id: "confirm-profile-and-identity",
    label: "Confirm installation identity",
    description:
      "Review the installation name, contact details, and the operating profile selected during installation.",
    href: "/admin/settings",
    actionLabel: "Review info",
  },
  {
    id: "verify-storage",
    label: "Verify managed storage",
    description:
      "Confirm that the selected data location is mounted, writable, backed up as intended, and large enough for real work.",
    href: "/admin/data-storage",
    actionLabel: "Check storage",
  },
  {
    id: "acknowledge-backups",
    label: "Document backup responsibility",
    description:
      "Record who backs up PostgreSQL and scientific data, how often, and how a restore is tested.",
  },
  {
    id: "review-members-and-enrollment",
    label: "Review members and enrollment",
    description:
      "Invite the people who need access and confirm whether this profile uses invitations or researcher self-registration.",
    href: "/admin/users",
    actionLabel: "Manage members",
  },
  {
    id: "review-modules-and-secrets",
    label: "Review modules and credentials",
    description:
      "Enable only the modules the team needs and configure real credentials for external services before use.",
    href: "/admin/modules",
    actionLabel: "Review modules",
  },
] as const;

const PROFILE_ITEMS: Readonly<Record<DeploymentProfileId, readonly OnboardingItem[]>> = {
  "sequencing-center": [
    {
      id: "configure-intake",
      label: "Configure sequencing intake",
      description: "Review the request form, sample metadata, and facility handoff fields.",
      href: "/admin/form-builder",
      actionLabel: "Configure intake",
    },
    {
      id: "configure-sequencers",
      label: "Configure sequencing technology",
      description: "Add the instruments and sequencing technologies the facility actually operates.",
      href: "/admin/sequencing-tech",
      actionLabel: "Configure sequencers",
    },
    {
      id: "configure-delivery-and-publishing",
      label: "Review delivery and archive publishing",
      description:
        "Confirm how results are delivered and configure real ENA credentials only if archive submission is used.",
      href: "/admin/ena",
      actionLabel: "Review data upload",
    },
    {
      id: "test-center-journey",
      label: "Complete a test order handoff",
      description: "Create a small request, receive it as facility staff, and verify the delivery path.",
      href: "/orders/new",
      actionLabel: "Create test order",
    },
  ],
  "shared-lab": [
    {
      id: "configure-shared-instruments",
      label: "Configure shared instruments",
      description: "Add the instruments the lab uses and confirm who maintains their settings.",
      href: "/admin/sequencing-tech",
      actionLabel: "Configure instruments",
    },
    {
      id: "review-shared-pipelines",
      label: "Review the shared pipeline catalog",
      description: "Enable only approved workflows and confirm the runtime available to lab members.",
      href: "/admin/settings/pipelines",
      actionLabel: "Review pipelines",
    },
    {
      id: "document-retention-and-quotas",
      label: "Document retention and quotas",
      description:
        "Agree how long raw data and results are retained, who may purge them, and what storage limits apply to shared work.",
    },
    {
      id: "test-shared-journey",
      label: "Complete one shared project",
      description: "Create a small project and verify that another lab member can continue the work safely.",
      href: "/orders/new",
      actionLabel: "Create test project",
    },
  ],
  "research-workbench": [
    {
      id: "confirm-import-policy",
      label: "Confirm upload and import policy",
      description:
        "Document file-size, retention, and allowed public-repository rules before members add datasets.",
      href: "/workbench/imports",
      actionLabel: "Review imports",
    },
    {
      id: "verify-workflow-runtime",
      label: "Verify the workflow runtime",
      description: "Confirm the local or Slurm executor, run directory, Conda, and Nextflow readiness.",
      href: "/admin/pipeline-runtime",
      actionLabel: "Check runtime",
    },
    {
      id: "review-workbench-pipelines",
      label: "Review analysis pipelines",
      description: "Install and enable the approved starter analyses available to workspace members.",
      href: "/admin/settings/pipelines",
      actionLabel: "Review pipelines",
    },
    {
      id: "test-workbench-journey",
      label: "Import or upload a small dataset",
      description: "Create a workspace, add a small real or test dataset, and run one starter analysis.",
      href: "/workbench/data",
      actionLabel: "Open Workbench",
    },
  ],
};

export function getOnboardingItems(profile: DeploymentProfileId): OnboardingItem[] {
  return [...COMMON_ITEMS, ...PROFILE_ITEMS[profile]];
}
