# Deployment profiles implementation TODO

Companion to `docs/architecture/deployment-profiles-plan.md`.

Decision gates and their recommended defaults are in `docs/architecture/deployment-profiles-decision-register.md`.

The guided installer, first-login onboarding, recovery states, and install test matrix are specified in `docs/architecture/deployment-profiles-installation-setup.md`.

This checklist implements the agreed model:

- SeqDesk remains one application with one release artifact, one npm launcher, one updater, and one canonical installer.
- The installer selects one of three profiles; the profiles are not separately maintained installers or builds.
- Sequencing Center has researchers, facility operators, and administrators.
- Shared Lab has members and one or more administrators. All members can perform ordinary scientific and sequencing work.
- Research Workbench has members and one or more administrators. Members work in their own or explicitly shared workspaces.
- Every profile uses the same sign-in mechanism. Account permissions, not separate login forms, determine access.
- Administrators can configure the installation. Administrative status does not replace resource ownership or automatically expose private Workbench data.
- A profile is a server-enforced runtime policy, not merely a different sidebar or cosmetic view.

Current branch checkpoint: the profile/configuration foundation, central
capability model, secure single-administrator bootstrap, Shared Lab account
flow, profile-aware navigation, guarded Workbench APIs, local file upload, and
real ENA FASTQ import are implemented. The installer now uses a versioned,
redacted `InstallPlan`; explains profile, access, database, storage, and workflow
choices; classifies existing targets; and preserves the selected profile during
maintenance. Authenticated first-login onboarding and profile-aware operational
readiness are implemented. A unified question engine, resumable apply
checkpoints, remaining action-level capability migration, and the full release
matrix remain open. A central server route map now returns `404` for unavailable
Workbench/sequencing/support domains, so hidden navigation is not the only
profile boundary.

Do these milestones in order. Do not expose a profile in production setup until its server-side authorization milestone is complete.

## Decision gate before implementation

- [x] Confirm one installation represents one organization/team and one deployment profile.
- [x] Confirm peer `ADMIN` accounts with no permanent system `OWNER` role.
- [x] Confirm Shared Lab and Workbench are invite-only by default after bootstrap.
- [x] Confirm the deployment profile is local/restart-required rather than database/UI-editable initially.
- [x] Confirm the authorization principal has a future service-account extension point without implementing service tokens now.
- [x] Confirm fresh guided installs require an explicit explained profile choice while existing installs preserve their profile.
- [x] Confirm all install entry points normalize to one versioned `InstallPlan` with a zero-mutation preview.
- [x] Confirm the installer creates one secure administrator only and moves additional accounts/settings to authenticated onboarding.
- [x] Confirm public setup status is read-only and cannot trigger seeding/account creation.
- [x] Confirm the first Workbench supports multiple private workspaces per researcher and defers collaboration.
- [x] Confirm imports copy into managed storage by default; approved-path linking is explicit and read-only.
- [x] Confirm browser upload, ENA/SRA, and generalized NCBI are ahead of arbitrary URL import.
- [x] Confirm the first Workbench makes no regulated/controlled human-data support claim and exposes no anonymous data links.
- [x] Confirm members can execute only administrator-approved, pinned workflow packages.
- [x] Use “Project” for the existing `Order` entity in Shared Lab UI while keeping storage/API names stable.

The installer naming is not an open choice: keep its existing hosted-install `--profile` option and use `--deployment-profile` for the new application mode.

## Milestone 0 — Characterize current behavior

- [ ] Add a table-driven inventory of the current `RESEARCHER` and `FACILITY_ADMIN` permissions.
- [ ] Cover representative read and write operations for orders, studies, samples, sequencing runs/files, pipelines, publishing, users, and settings.
- [ ] Add tests for the current root redirect and the `lab`/`workbench` route gates.
- [ ] Add tests proving that Workbench records are isolated by workspace owner.
- [ ] Add a smoke test for the existing NCBI Workbench importer and canvas persistence.
- [ ] Record the current direct-role-check baseline and fail CI if new raw checks are added outside the compatibility layer. The initial review found 159 non-test files with `FACILITY_ADMIN` or `RESEARCHER`, including 120 API files.

Likely areas:

- `src/lib/auth.ts`
- `src/app/api/**`
- `src/components/layout/**`
- `src/app/(dashboard)/**`
- `src/lib/workbench/**`

## Milestone 1 — Canonical deployment profile

- [x] Treat one SeqDesk installation as one organization/team with one active deployment profile; do not add per-user or multi-tenant profile switching.
- [x] Create `src/lib/deployment-profile/types.ts` with `sequencing-center`, `shared-lab`, and `research-workbench` identifiers.
- [x] Create profile definitions containing enabled domains, landing route, terminology, ownership scope, and default capability grants.
- [x] Create a server-side resolver using the existing configuration precedence.
- [x] Add `deployment.profile` to `SeqDeskConfig` in `src/lib/config/types.ts`.
- [x] Add defaults and environment/file parsing in `src/lib/config/loader.ts`.
- [x] Keep the deployment profile in local canonical configuration and restart-required; do not make it database/UI-editable in the first release.
- [x] Add install-profile coverage in `src/lib/install-profile/coverage.ts` and the installer apply code.
- [x] Add the selected profile to `seqdesk.config.example.json`.
- [x] Keep one application version and one release tarball for all profiles.
- [x] Keep `scripts/install-dist.sh` as the single canonical installer implementation.
- [x] Add an interactive installer question for `sequencing-center`, `shared-lab`, or `research-workbench`.
- [x] Add `--deployment-profile <id>` as the non-interactive application-mode option.
- [x] Preserve the existing `--profile <id>` option for hosted install profiles; do not repurpose it for deployment profiles.
- [x] Keep deployment profile, hosted install profile, and Nextflow execution profile names/types distinct throughout code and UI.
- [x] Allow hosted install profiles to preselect the deployment profile through the same canonical configuration field.
- [ ] Mark hosted-profile-managed settings as read-only and show their source; distinguish overridable profile defaults from non-overridable compatibility/security constraints.
- [ ] If profile-specific install URLs or commands are added, make them thin wrappers that call the canonical installer; do not copy the installer logic.
- [x] Treat the selected profile as installation-wide and fixed at runtime; do not add a per-user profile/view switch.
- [x] Do not expose profile switching in the initial web UI.
- [x] Preserve the selected profile across update and rollback operations.
- [x] Use one database schema and migration chain for all profiles.
- [ ] Install/download large optional pipeline packages, databases, instrument integrations, and import tools only when required by the selected profile/modules.
- [x] Map legacy `lab` to `sequencing-center` and legacy `workbench` to `research-workbench`.
- [x] Deprecate, but initially support, `NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY`.
- [x] Ensure authorization reads only the server-resolved profile, never a client-controlled or `NEXT_PUBLIC_*` value.
- [x] Validate profile identifiers and reject unknown values instead of falling back to a broader profile.
- [ ] Add a compatibility validator for profile x domain x module dependencies and conflicts.
- [ ] Run compatibility validation during install, hosted-profile reload, startup, and settings updates.
- [x] Pass a sanitized profile descriptor from the dashboard layout to client navigation/components.
- [x] Keep `sequencing-center` as the default for every existing installation.

Acceptance:

- [ ] Existing installations behave exactly as before without configuration changes.
- [ ] The same release artifact can be installed successfully as each of the three profiles.
- [x] No profile uses a copied or independently versioned installer.
- [x] Updating an installation changes the application version without changing its selected profile.
- [ ] Server routes, APIs, landing redirects, and client navigation agree on the active profile.
- [x] Profile resolution and legacy aliases have focused tests.
- [ ] Invalid or incomplete profile/module combinations fail closed with actionable diagnostics.

## Milestone 1A — Unified guided installation and setup

Implement the detailed journey in `docs/architecture/deployment-profiles-installation-setup.md` before exposing Shared Lab or Research Workbench as supported installation choices.

### One plan and one engine

- [x] Define a versioned, typed `InstallPlan` covering operation, release, deployment profile, access topology, database, storage, execution, enrollment, bootstrap administrator, optional content, value sources, and hosted locks.
- [x] Normalize guided answers, CLI/JSON configuration, hosted install profiles, and existing installation configuration into the same plan.
- [ ] Use one validator/default resolver and one application engine for every entry point.
- [x] Keep secret values behind protected references; never serialize them into saved/sanitized plans.
- [ ] Add `--plan` and `--plan --json` modes that resolve/validate/redact the plan and perform zero filesystem, database, or service mutations. The modes and no-target/database/service mutation test exist; remove temporary-file use while resolving remote/hosted configs before closing this item.
- [x] Generate the interactive review screen and unattended plan output from the same normalized representation.

### Existing-target classification

- [x] Detect new install, valid existing install, partial/failed install, and unrelated non-empty target before asking setup questions.
- [x] For an existing install, offer Update, Reconfigure, Diagnose/Resume, or Cancel rather than the fresh-install wizard.
- [x] Preserve/show the current deployment profile as read-only for update/reconfigure; reject a conflicting `--deployment-profile` unless a future explicit migration command is used.
- [ ] Load current values and show a redacted diff during reconfiguration.
- [x] Never seed generic accounts or overwrite existing passwords during update/reconfigure/database adoption.

### Guided question flow

- [x] Run a read-only basic prerequisite check before collecting configuration so unsupported runtime/host/tool/target conditions fail before the user completes the wizard.
- [ ] Replace the current split shell and Node prompt logic with one question schema/state machine, even if execution is internally divided around preflight.
- [x] Require an explicit deployment-profile selection on a fresh guided install; do not preselect Sequencing Center.
- [x] Present the three short workflow-based descriptions in the guided installer:
  - [x] Sequencing Center — people request sequencing and facility staff process/deliver it.
  - [x] Shared Lab — one team shares sequencing/analysis work; administrators additionally configure SeqDesk.
  - [x] Research Workbench — researchers import/upload existing data and run analyses in workspaces without sequencing-order handoffs.
- [x] Include the “Not sure?” helper based on external requesters, one shared lab team, or analysis of existing data.
- [x] Explain that this is one SeqDesk build and that changing the choice later requires a reviewed migration.
- [x] Ask “Only on this computer,” “On a team server,” or “Advanced/custom” before asking technical network questions.
- [x] Keep loopback binding as the default, distinguish browser URL/bind host/local health URL, require explicit non-loopback acknowledgement, and validate HTTPS expectations for team-server use.
- [x] Keep local PostgreSQL versus existing/managed PostgreSQL as the primary database choice and explain the operational tradeoff.
- [ ] Verify the selected database before requesting/generating account passwords.
- [x] Offer recommended managed storage locations first; show only the selected profile's labels and paths.
- [x] Validate storage existence/creation, writability, free space, mount availability, symlink resolution, dangerous roots, and overlapping/nested roots.
- [x] Ask about workflow execution with profile-aware guidance: optional for Sequencing Center, recommended for Shared Lab, and required for full Workbench operational readiness.
- [ ] Keep local versus Slurm executor details and package/runtime downloads behind the workflow choice; show estimated sizes.
- [x] Create exactly one initial administrator with an entered or generated strong password; remove the generic “also create a researcher” question.
- [x] Apply the profile's enrollment default and explain it: Sequencing Center researcher self-registration by default; Shared Lab and Workbench invite-only by default.
- [x] Defer extra users, SMTP/OIDC, instruments, ENA/repository credentials, and detailed module configuration to authenticated onboarding unless a hosted profile provides them.
- [ ] Offer deterministic example data only as a clearly labelled evaluation option; default it off on team servers.
- [ ] Keep telemetry separately consented and off by default.

### Review, apply, and verify

- [ ] Expand the current redacted review (which now includes profile, administrator, enrollment, database, paths, and pipeline enablement) with access topology, free-space results, executor/download estimates, optional content, value sources/locks, and warnings.
- [ ] Allow Back, Save sanitized plan, Install, and Cancel before mutations begin.
- [x] After confirmation, ask no new product/configuration questions; display stable pending/running/done/failed stages.
- [x] Take an exclusive per-target apply lock and record schema-versioned, secret-free recovery checkpoints through material stages.
- [ ] Run remaining detectable preflight before material changes and make recorded checkpoints automatically resumable/idempotent.
- [ ] Verify persisted profile, database/migrations, intended administrator, application version/profile response, storage writability, and selected runtime/smoke test.
- [x] Run the equivalent of `seqdesk doctor` automatically when the guided installer starts a persistent service.
- [ ] Distinguish “installed and verified,” “installed; manual start required,” “installed; optional/operational setup remains,” and restored/preserved failure states.
- [ ] Show a generated administrator password exactly once only after successful account creation, outside logs, plus the local reset command.
- [ ] Never create or advertise known `admin`/`user` packaged passwords in a supported release install.
- [x] Print profile-specific next steps and the correct first journey rather than sequencing-center instructions for every install.

### Public setup status and authenticated onboarding

- [x] Make `/api/setup/status` a read-only non-secret `GET`; remove account creation, seeding, hosted-profile application, and other mutations from anonymous polling.
- [x] Move bootstrap seeding into the installer or an explicit protected/idempotent startup operation.
- [x] Let public setup status report only database/schema, valid deployment profile, enrollment policy, and existence of an active administrator.
- [x] Add an authenticated, administrator-only, versioned onboarding checklist with explicit completion actor/time.
- [x] Separate base application readiness from profile operational readiness; do not equate a `SiteSettings` row with completed setup.
- [x] Route the first administrator login to incomplete critical onboarding and keep the checklist reopenable.
- [x] Show ordinary members a clear administrator-is-finishing-setup state when critical operational setup is incomplete.
- [x] Compose onboarding by profile: facility intake/instruments for Sequencing Center, shared storage/members/limits for Shared Lab, and storage/importers/runtime/first workspace for Workbench.

Acceptance:

- [ ] Fresh guided, unattended JSON, and hosted installs for all three profiles resolve through the same plan/validator and use the same release artifact.
- [ ] Irrelevant questions are absent for each profile and advanced questions stay optional.
- [ ] Cancellation before confirmation produces no material mutations.
- [ ] `--plan` is redacted and produces no material mutations.
- [x] Local-only/team-server URL and bind combinations are validated.
- [ ] Failure injection covers download, checksum, database, migration, storage, account creation, runtime, service start, and health verification with safe retry/recovery output.
- [x] Update/reconfigure preserve the deployment profile, accounts, and scientific data.
- [x] No anonymous setup-status request can create an account or change configuration.
- [x] No packaged fresh install uses known default credentials or creates a generic second account.
- [x] First login, onboarding, completion summary, and next steps use the selected profile's terminology and journey.

## Milestone 2 — Principal, capabilities, and scopes

- [x] Create `src/lib/authorization/` with `Principal`, `Capability`, `ResourceScope`, `hasCapability`, and `requireCapability`.
- [x] Reserve a principal kind for `human` versus future `service` accounts so automation never needs to impersonate a human administrator.
- [x] Keep system administration separate from scientific workflow permissions.
- [x] Represent at least `MEMBER` and `ADMIN` as system-level concepts.
- [x] Do not add a permanent system-level `OWNER`; administrators are peers protected by the final-active-administrator invariant.
- [x] Represent Sequencing Center requester/operator behavior separately from system administration.
- [x] Map current `RESEARCHER` users to member/requester behavior.
- [x] Map current `FACILITY_ADMIN` users to administrator/operator behavior during migration.
- [x] Refresh role/profile claims against current server state so promotion or demotion does not wait for a stale JWT to expire.
- [ ] Revoke or reject API credentials and queued privileged actions after account deactivation/demotion.
- [x] Define resource scopes: `own`, `department`, `workspace`, and `installation`.
- [x] Treat `createdBy` as immutable provenance, not as the universal access-control owner: Shared Lab records are installation-scoped and Workbench records are workspace-scoped.
- [x] Define the initial capability catalog:
  - [x] `system.settings.manage`
  - [x] `system.users.manage`
  - [x] `system.updates.manage`
  - [x] `system.pipelines.manage`
  - [x] `system.workflows.publish`
  - [x] `system.quotas.manage`, `system.retention.manage`
  - [x] `orders.create`, `orders.read`, `orders.read_all`, `orders.process`
  - [x] `studies.create`, `studies.read`, `studies.read_all`, `studies.publish`
  - [x] `samples.manage`
  - [x] `sequencing.runs.manage`, `sequencing.files.manage`, `sequencing.deliver`
  - [x] `analysis.run`, `analysis.read_own`, `analysis.read_all`, `analysis.resolve_outputs`
  - [x] `analysis.cancel_own`, `analysis.cancel_all`
  - [x] `workbench.use`, `workbench.import`, `workbench.run`
  - [x] `data.archive`, `data.restore`, `data.purge_shared`
  - [x] `publishing.submit`
- [x] Add table-driven tests for representative profile x account level x capability x scope combinations; expand to exhaustive catalog coverage before release.
- [ ] Add tests proving an already signed-in administrator loses protected access immediately after demotion or deactivation.
- [ ] Add a repository check that rejects new `session.user.role === ...` authorization outside the compatibility package.

Acceptance:

- [x] A normal Shared Lab member has all scientific and sequencing-operation capabilities but no system-management capabilities.
- [x] A Shared Lab administrator has the same scientific capabilities plus system-management capabilities.
- [x] An administrator can exist without making “administrator” a separate login flow.

## Milestone 3 — Convert authorization call sites

Convert APIs before relying on capability-based UI.

- [x] Treat a disabled domain as unavailable on the server even if its code is present in the shared artifact.
- [ ] Apply profile and capability checks to API routes, server-rendered route layouts, background-job entry points, and resource queries.
- [ ] Deny access when the profile or permission cannot be resolved; do not fall back to the broadest profile.

### System administration

- [ ] Convert `/api/admin/users`, invites, departments, modules, form configuration, and settings routes.
- [ ] Convert pipeline install/configuration, database download, execution defaults, workers, updates, telemetry, ENA credentials, and MinKNOW settings.
- [ ] Ensure secret-bearing responses remain administrator-only.

### Facility and sample operations

- [ ] Convert order list/detail/create/update/delete access and visibility filters.
- [ ] Convert study list/detail/create/update/delete and publishing access.
- [ ] Convert sample CRUD, sample-study assignment, and table/export access.
- [ ] Convert sequencing discovery, upload, run assignment, streaming, visibility, and delivery operations.
- [ ] Convert sidebar entity/count queries to use centralized resource scopes.
- [ ] Convert tickets/notes/mentions and make the domain optional outside Sequencing Center.

### Analysis

- [ ] Convert pipeline run list/create/start/cancel/delete routes.
- [ ] Convert log, weblog, artifact, output resolution, result selection, and cleaned-read routes.
- [ ] Allow `analysis.run` independently of system pipeline configuration.
- [ ] Keep pipeline installation and global defaults behind `system.pipelines.manage`.
- [ ] Treat installation of a pipeline/package as privileged host code installation; never infer it from permission to run an approved pipeline.
- [ ] Apply configured compute/concurrency limits to member-launched runs.

### Workbench

- [x] Add profile/domain guards to every `/api/workbench/**` route.
- [x] Keep workspace ownership checks on analyses, datasets, imports, and results.
- [x] Do not grant Workbench administrators automatic access to every private workspace.

Acceptance:

- [ ] UI hiding is never the only authorization control.
- [ ] Disabled profile domains return `404`; available domains/actions return `403` when the authenticated principal lacks capability or resource scope; missing/invalid authentication returns `401`.
- [ ] Cross-user and cross-workspace access tests pass.

## Milestone 4 — Shared Lab accounts and registration

- [ ] Add `shared-lab` to setup as an option only after Milestones 1–3 pass.
- [x] Use one registration page and one login page.
- [x] Remove the researcher/facility-admin choice from Shared Lab registration.
- [x] Label ordinary accounts using profile terminology rather than always “Researcher.”
- [x] Default Shared Lab and Research Workbench to invite-only enrollment after bootstrap; keep self-registration an explicit administrator setting and retain configurable researcher self-registration for Sequencing Center.
- [x] Keep all profiles authenticated; do not add a no-login “single-user” shortcut.
- [x] Make the initial account on a new installation an administrator through the secure bootstrap flow.
- [ ] Create/claim the first administrator through locally supplied installer credentials or a short-lived single-use bootstrap token; do not leave an externally reachable first-user-wins registration endpoint.
- [ ] Make initial-administrator claiming atomic so concurrent requests cannot both pass an empty-installation check.
- [x] Let administrators invite/create members.
- [x] Let administrators promote a member to administrator.
- [x] Let administrators demote another administrator.
- [ ] Prevent demotion, deletion, or deactivation of the final active administrator.
- [x] Enforce the final-administrator check and role update in one transaction to prevent concurrent demotions.
- [x] Prevent users from self-promoting through registration or profile-update requests.
- [ ] Record administrator promotion/demotion with actor, target, timestamp, and old/new level.
- [ ] Default to account deactivation; make hard deletion a separate destructive workflow.
- [ ] Keep Shared Lab scientific records accessible after their creator is deactivated.
- [ ] Separate reversible archive/trash from permanent purge; keep permanent purge of shared data administrator-only by default.
- [ ] Allow members to cancel their own runs; require a separate capability to cancel another member's active run.
- [ ] Require explicit transfer, export, retention, or purge handling before deleting the owner of a private Workbench workspace.
- [ ] Prevent user removal from cascade-deleting a Workbench workspace or research history unexpectedly.
- [ ] Preserve immutable creator/actor provenance when operational ownership changes.
- [ ] Add a local, audited administrator-recovery command for an operator with filesystem/database access.
- [ ] Ensure administrator recovery cannot be invoked through an unauthenticated browser endpoint.
- [ ] Keep capability/resource authorization independent of the credential provider so OIDC/LDAP can be added later without implementing them in this milestone.
- [ ] Keep profile selection install-time only for the first release; if transitions are added later, expose them through a guarded administrative migration command rather than a casual settings toggle.

Likely areas:

- `src/app/register/page.tsx`
- `src/app/register/admin/page.tsx`
- `src/app/api/register/route.ts`
- `src/app/setup/page.tsx`
- `src/app/api/admin/users/**`
- `src/lib/auth.ts`
- `prisma/schema.prisma`

Acceptance:

- [ ] A clean Shared Lab install cannot end up without an administrator.
- [ ] Multiple administrators are supported.
- [ ] Members and administrators sign in through the same page.
- [ ] Registration never accepts an administrator grant without existing administrator authorization or first-account bootstrap rules.
- [ ] An unclaimed installation exposed to the network cannot be claimed by an arbitrary browser visitor.
- [ ] Deactivated or demoted accounts cannot retain access through an existing session or API credential.
- [ ] Losing normal administrator credentials has a documented local recovery procedure.

## Milestone 5 — Shared Lab scientific experience

- [ ] Give all Shared Lab members installation-wide scope for normal lab projects/orders, studies, samples, sequencing operations, analyses, and results.
- [ ] Remove requester-to-facility handoff language and actions from Shared Lab pages.
- [ ] Hide tickets, departments, billing, and requester communication by default.
- [ ] Keep tickets and billing as optional compatible modules if a small lab wants them.
- [ ] Remove researcher-only/facility-only branches from shared scientific views; render actions from capabilities.
- [x] Keep administrator settings links visible only to administrators.
- [ ] Add optimistic concurrency to meaningful shared-record edits; reject stale updates with `409 Conflict` instead of silently overwriting another member's change.
- [ ] Keep multi-record operations such as sample/run assignment transactional.
- [x] Display the existing `Order` record as “Project” in Shared Lab while keeping storage/API names stable.
- [ ] Adjust notifications so normal Shared Lab actions do not notify an artificial requester/facility counterpart.
- [ ] Add administrator-configurable compute, concurrency, storage, and retention limits without removing members' ability to launch approved workflows.
- [ ] Update help text, empty states, onboarding, and demo/seed data for Shared Lab.

Acceptance journey:

- [ ] Member A creates a project and samples.
- [ ] Member B sees them, attaches/discovers sequencing data, manages a sequencing run, and launches a workflow.
- [ ] Both members see the resulting status and outputs.
- [ ] Neither member can open or call users, credentials, storage-root, pipeline-installation, or update administration.
- [ ] An administrator can perform the same lab work and configure those protected settings.

## Milestone 6 — Explicit account schema migration

Do this only after authorization no longer depends on raw `User.role` checks.

- [ ] Add an explicit system-level field, for example `systemRole: MEMBER | ADMIN`.
- [ ] Add an optional facility workflow field if the Sequencing Center needs independent requester/operator assignments.
- [ ] Backfill current users:
  - [ ] `RESEARCHER` -> `systemRole=MEMBER`, facility role `REQUESTER`.
  - [ ] `FACILITY_ADMIN` -> `systemRole=ADMIN`, facility role `OPERATOR`.
- [ ] Preserve current sessions during deployment or document the required re-login.
- [ ] Update NextAuth token/session fields to carry only the minimal principal data needed by the UI.
- [ ] Remove role-specific registration payloads where the profile determines defaults.
- [ ] Retain a compatibility reader until all stored users and tests are migrated.
- [ ] Remove the deprecated `role` field only in a later release after rollback compatibility is no longer required.
- [ ] Follow the repository database reset-and-seed workflow while developing the schema change.

Acceptance:

- [ ] System administrators can be added in every profile.
- [ ] Sequencing Center operators do not need access to installation secrets unless separately made administrators.
- [ ] Shared Lab members receive operational rights from the profile rather than an admin role.

## Milestone 7 — Profile-composed UI and navigation

- [x] Replace `isWorkbenchAppSurface()` branches in the root page, dashboard shell, sidebar, and Workbench layout with the canonical profile context.
- [x] Build sidebar navigation from enabled domains plus capabilities.
- [x] Build page titles and default landing routes from profile definitions.
- [x] Gate facility, sequencing, publishing, Workbench, and admin route groups on the server.
- [ ] Make terminology a profile concern instead of adding page-level ternaries.
- [ ] Keep route names, API fields, exported manifests, and automation contracts stable when only UI terminology changes.
- [x] Ensure Workbench and primary sequencing direct URLs cannot bypass profile availability or permissions; continue the API migration for remaining domains.
- [ ] Update profile-specific login, registration, help, and empty-state copy.

Likely areas:

- `src/app/page.tsx`
- `src/components/layout/DashboardShell.tsx`
- `src/components/layout/sidebar/**`
- `src/lib/app-surface.ts`
- `src/app/(dashboard)/(workbench)/workbench/layout.tsx`

## Milestone 8 — Research Workbench completion

- [ ] Remove `WorkbenchWorkspace.ownerId @unique` so a user can create multiple private workspaces; enforce at most one default workspace per user.
- [ ] Keep collaborative workspace membership out of the first release unless it becomes a launch requirement; preserve an additive path to resource-level `OWNER`/`EDITOR`/`VIEWER` membership later.
- [ ] Replace user-cascade ownership so deleting/deactivating a login cannot cascade-delete a Workbench workspace or import provenance.
- [ ] Generalize `WorkbenchDataset` from NCBI genome bundles to workspace-owned typed datasets with asset manifests and provenance.
- [ ] Separate logical workspace datasets from immutable `DataAsset`/content-addressed `StorageObject` records; do not use the current global cache key as an authorization boundary.
- [ ] Reference-count physical storage so deleting one workspace link cannot remove bytes still used by another dataset, run, trash/retention record, or cache entry.
- [ ] Represent samples and typed/nested asset collections explicitly, including single/paired reads, lanes, technical replicates, samplesheets, references, annotations, and reports.
- [ ] Add resumable upload-session persistence with reserved bytes, idempotent completion, checksum/type validation, cancellation, and abandoned-upload cleanup.
- [x] Add a bounded authenticated local-disk upload path that copies supported files into private managed workspace storage and records a SHA-256 checksum; resumability/quotas remain the next slice.
- [ ] Enforce archive entry-count, expanded-size, traversal, and compression-ratio limits before materializing an uploaded archive.
- [ ] Add imports from administrator-approved server roots; never accept arbitrary filesystem paths from clients.
- [ ] Copy approved-path imports into managed storage by default; if read-only linking is enabled, record/revalidate identity, size, modification time, and checksum at run start.
- [x] Add real ENA/SRA/DRA accession import through the public ENA API with host allowlisting, streaming size limits, and MD5 verification.
- [ ] Generalize the existing NCBI taxon importer.
- [ ] Preserve repository metadata and accessions separately from downloaded bytes; do not assume an SRA run file contains BioSample/BioProject metadata.
- [ ] Defer arbitrary HTTP(S) import from the first release; when added, require provider/host policy, redirect revalidation, internal-address blocking, transfer limits, and archive-expansion limits.
- [ ] Define installation-owned versus user-owned importer credentials; current public ENA import needs no credential and Workbench member APIs now redact internal storage/log/tool paths.
- [ ] Apply an explicit data-support boundary: authenticated/private use only, no anonymous public dataset links, and no regulated/controlled human-data compliance claim in the first release.
- [ ] Enforce installation capacity/free-space floors and optional member/workspace quotas, including active uploads, work directories, managed outputs, caches, trash, and retention holds.
- [ ] Count deduplicated storage once physically while displaying every logical reference that prevents reclamation.
- [ ] Preserve metadata needed for future asynchronous RO-Crate-compatible dataset/analysis export.
- [ ] Complete Workbench Data, Imports, Runs, and Results views.

Acceptance:

- [ ] A member can create several private workspaces and usable datasets without an order or study.
- [ ] Dataset provenance includes its source, retrieval/upload details, checksums, and validation state.
- [ ] Cache reuse never grants another workspace access to a dataset.
- [ ] Changing dataset bytes produces a new dataset/version; display metadata edits cannot change the immutable run input snapshot.
- [ ] Deactivating a user does not destroy their Workbench data.

## Milestone 9 — Target-agnostic pipeline execution

- [ ] Add target adapters for `order`, `study`, and `workbench-analysis`.
- [ ] Move target authorization, input resolution, display metadata, and output publishing behind the adapter interface.
- [ ] Add Workbench run persistence additively while retaining current `studyId` and `orderId` compatibility.
- [ ] Validate Workbench dataset kinds/assets against semantic pipeline input requirements.
- [ ] Materialize Workbench outputs as result datasets rather than `Read`, `Assembly`, or `Bin` records tied to fake orders.
- [ ] Keep facility-specific output write-back in facility adapters.
- [ ] Snapshot exact input asset IDs/checksums, approved pipeline package/revision/checksum, allowed parameters, effective execution configuration, initiating principal, and available tool/container versions for every run.
- [ ] Model retries/resumes as attempts linked to one logical run instead of overwriting the prior execution record.
- [ ] Permit members to run only administrator-approved packages; reject arbitrary scripts, containers, Nextflow configuration, and unrestricted cluster options.
- [ ] Pass runtime credentials through a dedicated secret mechanism; never serialize secret values as pipeline parameters, commands, logs, or provenance.
- [ ] Complete canvas pipeline-node execution and Workbench run/result navigation.

Acceptance journey:

- [ ] A Workbench member imports or uploads a real small dataset.
- [ ] The member runs a real packaged pipeline from the canvas.
- [ ] Progress, logs, errors, provenance, and results remain visible in Workbench.
- [ ] The same runtime still executes existing order/study pipelines without regression.

## Milestone 10 — Release readiness and cleanup

- [ ] Add one clean-install profile fixture for each deployment profile.
- [ ] Run those three fixtures against the exact same release tarball.
- [ ] Verify one checksum, one update feed, and one rollback path for the shared artifact.
- [ ] Verify profile-specific optional dependencies are installed only when selected.
- [ ] Define a coherent backup set: database, canonical configuration, secrets, installed pipeline metadata, and managed data roots.
- [ ] Add restore verification that checks the selected profile and module compatibility before workers start.
- [ ] Test account deactivation, data transfer/retention, and administrator recovery.
- [ ] Test interrupted/resumed uploads, quota reservation release, storage-object reference counting, and safe cleanup.
- [ ] Test stale Shared Lab edits return conflicts instead of overwriting newer state.
- [ ] Test deployment-profile/default/constraint precedence and prove hosted-managed values cannot be changed through the UI.
- [ ] Document the supported data boundary and avoid controlled/regulated-data claims until the separate security design exists.
- [ ] If profile migration is added later, require preflight/backup, show visibility and permission changes, and block migration while incompatible jobs or sequencing streams are active.
- [ ] Test upgrades and rollbacks with stale sessions to prove permission changes remain enforced.
- [ ] Add the three mandatory end-to-end journeys to release gates.
- [ ] Test supported profile transitions and rollback behavior.
- [ ] Confirm profile changes never delete hidden-domain data or silently broaden access.
- [ ] Update installer documentation and configuration examples.
- [ ] Update demo experiences and screenshots where appropriate.
- [ ] Remove legacy app-surface aliases after a documented deprecation period.
- [ ] Move stable code into domain packages only after the boundaries have proven useful.
- [ ] Keep changes to SeqDesk.com or MetaxPath outside this branch unless separately requested.

## Recommended first two implementation changes

### Change 1: profile foundation

- [ ] Implement Milestone 1 only.
- [ ] Preserve all existing behavior.
- [ ] Do not yet offer Shared Lab in setup.

### Change 2: capability vertical slice

- [ ] Implement the principal/capability primitives.
- [ ] Convert pipeline run list/create/start and the corresponding UI as one complete slice.
- [ ] Prove that “run a workflow” and “configure installed workflows/pipelines” are separate capabilities.
- [ ] Use that pattern to convert the remaining APIs incrementally.
