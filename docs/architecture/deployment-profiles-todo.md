# Deployment profiles implementation TODO

Companion to `docs/architecture/deployment-profiles-plan.md`.

This checklist implements the agreed model:

- Sequencing Center has researchers, facility operators, and administrators.
- Shared Lab has members and one or more administrators. All members can perform ordinary scientific and sequencing work.
- Research Workbench has members and one or more administrators. Members work in their own or explicitly shared workspaces.
- Every profile uses the same sign-in mechanism. Account permissions, not separate login forms, determine access.
- Administrators can configure the installation. Administrative status does not replace resource ownership or automatically expose private Workbench data.

Do these milestones in order. Do not expose a profile in production setup until its server-side authorization milestone is complete.

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

- [ ] Create `src/lib/deployment-profile/types.ts` with `sequencing-center`, `shared-lab`, and `research-workbench` identifiers.
- [ ] Create profile definitions containing enabled domains, landing route, terminology, ownership scope, and default capability grants.
- [ ] Create a server-side resolver using the existing configuration precedence.
- [ ] Add `deployment.profile` to `SeqDeskConfig` in `src/lib/config/types.ts`.
- [ ] Add defaults and environment/file parsing in `src/lib/config/loader.ts`.
- [ ] Add database merge/save handling in `src/lib/config/database-merge.ts` if profile editing is supported after installation.
- [ ] Add install-profile coverage in `src/lib/install-profile/coverage.ts` and the installer apply code.
- [ ] Add the selected profile to `seqdesk.config.example.json`.
- [ ] Map legacy `lab` to `sequencing-center` and legacy `workbench` to `research-workbench`.
- [ ] Deprecate, but initially support, `NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY`.
- [ ] Ensure authorization reads only the server-resolved profile, never a client-controlled or `NEXT_PUBLIC_*` value.
- [ ] Pass a sanitized profile descriptor from the dashboard layout to client navigation/components.
- [ ] Keep `sequencing-center` as the default for every existing installation.

Acceptance:

- [ ] Existing installations behave exactly as before without configuration changes.
- [ ] Server routes, APIs, landing redirects, and client navigation agree on the active profile.
- [ ] Profile resolution and legacy aliases have focused tests.

## Milestone 2 — Principal, capabilities, and scopes

- [ ] Create `src/lib/authorization/` with `Principal`, `Capability`, `ResourceScope`, `hasCapability`, and `requireCapability`.
- [ ] Keep system administration separate from scientific workflow permissions.
- [ ] Represent at least `MEMBER` and `ADMIN` as system-level concepts.
- [ ] Represent Sequencing Center requester/operator behavior separately from system administration.
- [ ] Map current `RESEARCHER` users to member/requester behavior.
- [ ] Map current `FACILITY_ADMIN` users to administrator/operator behavior during migration.
- [ ] Define resource scopes: `own`, `department`, `workspace`, and `installation`.
- [ ] Define the initial capability catalog:
  - [ ] `system.settings.manage`
  - [ ] `system.users.manage`
  - [ ] `system.updates.manage`
  - [ ] `system.pipelines.manage`
  - [ ] `system.workflows.publish`
  - [ ] `orders.create`, `orders.read`, `orders.read_all`, `orders.process`
  - [ ] `studies.create`, `studies.read`, `studies.read_all`, `studies.publish`
  - [ ] `samples.manage`
  - [ ] `sequencing.runs.manage`, `sequencing.files.manage`, `sequencing.deliver`
  - [ ] `analysis.run`, `analysis.read_own`, `analysis.read_all`, `analysis.resolve_outputs`
  - [ ] `workbench.use`, `workbench.import`, `workbench.run`
  - [ ] `publishing.submit`
- [ ] Add table-driven tests for every profile x account level x capability x scope combination.
- [ ] Add a repository check that rejects new `session.user.role === ...` authorization outside the compatibility package.

Acceptance:

- [ ] A normal Shared Lab member has all scientific and sequencing-operation capabilities but no system-management capabilities.
- [ ] A Shared Lab administrator has the same scientific capabilities plus system-management capabilities.
- [ ] An administrator can exist without making “administrator” a separate login flow.

## Milestone 3 — Convert authorization call sites

Convert APIs before relying on capability-based UI.

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

### Workbench

- [ ] Add profile/domain guards to every `/api/workbench/**` route; they currently require authentication but do not consistently enforce the active app surface.
- [ ] Keep workspace ownership checks on analyses, datasets, imports, and results.
- [ ] Do not grant Workbench administrators automatic access to every private workspace.

Acceptance:

- [ ] UI hiding is never the only authorization control.
- [ ] Disabled profile domains return the chosen consistent response (`404` for unavailable domain or `403` for an understood but forbidden action).
- [ ] Cross-user and cross-workspace access tests pass.

## Milestone 4 — Shared Lab accounts and registration

- [ ] Add `shared-lab` to setup as an option only after Milestones 1–3 pass.
- [ ] Use one registration page and one login page.
- [ ] Remove the researcher/facility-admin choice from Shared Lab registration.
- [ ] Label ordinary accounts “Member,” not “Researcher.”
- [ ] Make the first account on a new Shared Lab installation an administrator.
- [ ] Let administrators invite/create members.
- [ ] Let administrators promote a member to administrator.
- [ ] Let administrators demote another administrator.
- [ ] Prevent demotion, deletion, or deactivation of the final active administrator.
- [ ] Prevent users from self-promoting through registration or profile-update requests.
- [ ] Record administrator promotion/demotion with actor, target, timestamp, and old/new level.
- [ ] Decide whether profile switching is install-only or exposed through an audited migration wizard; do not add a casual toggle.

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

## Milestone 5 — Shared Lab scientific experience

- [ ] Give all Shared Lab members installation-wide scope for normal lab projects/orders, studies, samples, sequencing operations, analyses, and results.
- [ ] Remove requester-to-facility handoff language and actions from Shared Lab pages.
- [ ] Hide tickets, departments, billing, and requester communication by default.
- [ ] Keep tickets and billing as optional compatible modules if a small lab wants them.
- [ ] Remove researcher-only/facility-only branches from shared scientific views; render actions from capabilities.
- [ ] Keep administrator settings links visible only to administrators.
- [ ] Decide the display term for the existing `Order` record: initially keep storage/API names and test “Project” or “Sequencing Work” as Shared Lab UI terminology.
- [ ] Adjust notifications so normal Shared Lab actions do not notify an artificial requester/facility counterpart.
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

- [ ] Replace `isWorkbenchAppSurface()` branches in the root page, dashboard shell, sidebar, and Workbench layout with the canonical profile context.
- [ ] Build sidebar navigation from enabled domains plus capabilities.
- [ ] Build page titles and default landing routes from profile definitions.
- [ ] Gate facility, sequencing, publishing, Workbench, and admin route groups on the server.
- [ ] Make terminology a profile concern instead of adding page-level ternaries.
- [ ] Ensure direct URLs cannot bypass profile availability or permissions.
- [ ] Update profile-specific login, registration, help, and empty-state copy.

Likely areas:

- `src/app/page.tsx`
- `src/components/layout/DashboardShell.tsx`
- `src/components/layout/sidebar/**`
- `src/lib/app-surface.ts`
- `src/app/(dashboard)/(workbench)/workbench/layout.tsx`

## Milestone 8 — Research Workbench completion

- [ ] Generalize `WorkbenchDataset` from NCBI genome bundles to typed datasets with asset manifests and provenance.
- [ ] Add resumable browser upload with checksum, quota/free-space checks, cancellation, and abandoned-upload cleanup.
- [ ] Add imports from administrator-approved server roots; never accept arbitrary filesystem paths from clients.
- [ ] Add real ENA/SRA accession import.
- [ ] Generalize the existing NCBI taxon importer.
- [ ] Add protected HTTP(S) import with redirect revalidation, internal-address blocking, size limits, and archive-expansion limits.
- [ ] Complete Workbench Data, Imports, Runs, and Results views.
- [ ] Decide whether shared Workbench workspaces are required for the first release; keep private workspaces as the default.

Acceptance:

- [ ] A member can create a usable dataset without an order or study.
- [ ] Dataset provenance includes its source, retrieval/upload details, checksums, and validation state.
- [ ] Cache reuse never grants another workspace access to a dataset.

## Milestone 9 — Target-agnostic pipeline execution

- [ ] Add target adapters for `order`, `study`, and `workbench-analysis`.
- [ ] Move target authorization, input resolution, display metadata, and output publishing behind the adapter interface.
- [ ] Add Workbench run persistence additively while retaining current `studyId` and `orderId` compatibility.
- [ ] Validate Workbench dataset kinds/assets against semantic pipeline input requirements.
- [ ] Materialize Workbench outputs as result datasets rather than `Read`, `Assembly`, or `Bin` records tied to fake orders.
- [ ] Keep facility-specific output write-back in facility adapters.
- [ ] Complete canvas pipeline-node execution and Workbench run/result navigation.

Acceptance journey:

- [ ] A Workbench member imports or uploads a real small dataset.
- [ ] The member runs a real packaged pipeline from the canvas.
- [ ] Progress, logs, errors, provenance, and results remain visible in Workbench.
- [ ] The same runtime still executes existing order/study pipelines without regression.

## Milestone 10 — Release readiness and cleanup

- [ ] Add one clean-install profile fixture for each deployment profile.
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
