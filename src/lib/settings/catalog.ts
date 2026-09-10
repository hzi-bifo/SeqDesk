import { Building2, FlaskConical, HardDrive, Layers3, Settings2, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { AVAILABLE_MODULES } from "@/lib/modules/types";

export interface SettingsLink {
  label: string;
  href: string;
  description: string;
  keywords?: string;
  moduleId?: string;
  overviewOnly?: boolean;
}

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  moduleId?: string;
  links: SettingsLink[];
}

export interface SettingsContext {
  dynamicStudiesEnabled: boolean;
  centerAccounts: boolean;
}

/** Navigation metadata only. Modules and pipelines keep their own existing registries. */
export function getSettingsSections(context: SettingsContext): SettingsSection[] {
  const moduleSearchTerms = AVAILABLE_MODULES.map(module => `${module.name} ${module.description}`).join(" ");
  return [
    {
      id: "modules", title: "Modules", description: "Choose what your team can use in SeqDesk.", icon: Layers3,
      color: "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
      links: [
        { label: "Manage modules", href: "/admin/modules", description: "Enable features and open their configuration.", keywords: `enable disable ${moduleSearchTerms}` },
        { label: "Data source modules", href: "/admin/modules?category=data-sources", description: "Facility sequencing and public raw-read importers.", overviewOnly: true },
      ],
    },
    {
      id: "metadata", title: "Metadata & forms", description: "Decide which information you collect about data, samples and studies.", icon: SlidersHorizontal,
      color: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
      links: [
        { label: "Sequencing data fields", href: "/admin/form-builder", description: "Shared sequencing-data and sample fields; also used by the facility request form.", keywords: "sample metadata order intake form questionnaire" },
        { label: context.dynamicStudiesEnabled ? "Study definitions" : "Study fields", href: context.dynamicStudiesEnabled ? "/admin/study-definitions" : "/admin/study-form-builder", description: "Study information, questionnaires and sample metadata.", keywords: "study form project cohort" },
        { label: "MIxS checklists", href: "/admin/mixs-checklists", description: "Standard metadata checklists for different sample environments." },
      ],
    },
    {
      id: "analysis", title: "Pipelines & analysis", description: "Manage workflows, their requirements and the analyses behind reports.", icon: FlaskConical,
      color: "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
      links: [
        { label: "Pipelines & databases", href: "/admin/settings/pipelines", description: "Install and enable pipelines, configure inputs and set up required databases.", keywords: "store workflow download reference index input output requirements" },
        { label: "Where pipelines run", href: "/admin/pipeline-runtime", description: "SeqDesk server or Slurm, run folders and shared execution defaults.", keywords: "local cluster cpu memory conda nextflow java scheduler" },
        { label: "Report analysis settings", href: "/admin/settings/analysis", description: "Analysis environments, isolation, network access and time limits.", keywords: "explore python R conda sandbox security", moduleId: "explore" },
      ],
    },
    {
      id: "storage", title: "Storage", description: "Choose where SeqDesk keeps data and check access to it.", icon: HardDrive,
      color: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
      links: [
        { label: "Data storage", href: "/admin/data-storage", description: "Shared storage for imported reads, facility files and analysis data.", keywords: "disk space directory path cache downloads files" },
        { label: "Storage & compute", href: "/admin/data-compute", description: "Check your infrastructure and import an existing configuration.", keywords: "settings.json configuration import export" },
      ],
    },
    {
      id: "access", title: "Users & access", description: "Manage membership, administration and who can share data.", icon: Users,
      color: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
      links: [
        { label: "Members", href: "/admin/users", description: "Review and manage the people using this installation.", keywords: "researcher user account login" },
        { label: "Administrators & invitations", href: "/admin/admin-accounts", description: "Invite members or administrators and configure data sharing.", keywords: "roles permissions enrollment access" },
        ...(context.centerAccounts ? [{ label: "Departments", href: "/admin/departments", description: "Manage departmental groups for facility accounts." }] : []),
      ],
    },
    {
      id: "facility", title: "Facility sequencing", description: "Instrument and run settings for teams that sequence samples in-house.", icon: Building2, moduleId: "sequencing-management",
      color: "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
      links: [
        { label: "Sequencers & kits", href: "/admin/sequencing-tech", description: "Instruments, technologies, kits and barcodes." },
        { label: "Sequencing run fields", href: "/admin/sequencing-run-form-builder", description: "Fields used when assigning samples to an instrument run." },
        { label: "MinKNOW integration", href: "/admin/minknow-stream", description: "Connect nanopore instrument monitoring." },
      ],
    },
    {
      id: "system", title: "System & services", description: "Notifications, archive submission and maintenance of your installation.", icon: Settings2,
      color: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200",
      links: [
        { label: "Installation details", href: "/admin/settings/general", description: "Installation name and contact email used in notifications.", keywords: "identity site institution contact name reply-to" },
        { label: "Notifications", href: "/admin/settings/notifications", description: "Email delivery and in-app notification behavior.", keywords: "mail relay SMTP" },
        { label: "Publish to ENA", href: "/admin/ena", description: "Credentials and settings for submitting data to ENA. Not needed to import SRA / ENA reads.", keywords: "archive upload accession submission" },
        { label: "Background workers", href: "/admin/background-workers", description: "Check and manage the services that process imports, pipelines and analyses.", keywords: "jobs monitor queue" },
        { label: "System & maintenance", href: "/admin/settings/system", description: "Updates, diagnostics, privacy settings and advanced configuration.", keywords: "version tools telemetry demo feature flags config installation identity" },
        ...(context.centerAccounts ? [{ label: "Support messages", href: "/messages", description: "Respond to user support requests." }] : []),
      ],
    },
  ];
}

export function isSettingsLinkActive(pathname: string, href: string): boolean {
  const target = href.split(/[?#]/)[0];
  return pathname === target || pathname.startsWith(`${target}/`);
}

/** Search descriptions too, so people can find a setting without knowing its page title. */
export function filterSettingsSections(sections: SettingsSection[], query: string): SettingsSection[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.flatMap(section => {
    const links = section.links.filter(link => terms.every(term =>
      `${section.title} ${section.description} ${link.label} ${link.description} ${link.keywords ?? ""}`.toLocaleLowerCase().includes(term)
    ));
    return links.length ? [{ ...section, links }] : [];
  });
}
