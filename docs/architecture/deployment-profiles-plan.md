# SeqDesk deployment profiles and domain separation plan

Status: proposed

Branch: `codex/modular-deployment-modes`

Scope: application architecture and phased implementation plan; no production behavior is changed by this document.

## Decision summary

SeqDesk should support three explicit deployment profiles in two product families:

1. **Sequencing Center** (`sequencing-center`): the current service workflow, with researchers requesting work and facility operators processing it.
2. **Shared Lab** (`shared-lab`): sequencing-center capabilities for a small team, without a requester-versus-facility split in everyday work.
3. **Research Workbench** (`research-workbench`): a researcher-first analysis environment organized around workspaces, datasets, analyses, runs, and results rather than sequencing orders.

A deployment profile is not another feature flag. It selects the product's workflow topology, navigation, language, default permissions, and enabled domains. Feature modules remain smaller optional capabilities within a compatible profile.

The recommended implementation is incremental. Keep the current order/study workflow working, centralize profile and authorization decisions first, then complete the existing Workbench domain and connect it to the pipeline engine through a generic run-target boundary. Avoid a big-bang rewrite of the current data model or route tree.

### Packaging decision: one application and one installer

SeqDesk should remain **one application with one codebase, one version, one release tarball, one npm launcher, one updater, and one canonical installer**. The installer selects and persists one of the three deployment profiles; it must not install three separately maintained application variants.

The three profiles are installation presets and runtime policies, not separate products:

```text
one SeqDesk release artifact
        |
        +-- profile: sequencing-center
        +-- profile: shared-lab
        +-- profile: research-workbench
```

The interactive installer should ask which profile to use. Automated and hosted-profile installations should pass the same choice non-interactively. All paths must invoke the same installer and consume the same signed/checksummed release artifact. Convenience links or commands may preselect a profile, but they must be thin entry points into the canonical installer rather than copied installer scripts.

This is the recommended approach for a solo developer because fixes, migrations, dependency updates, security patches, release verification, and rollback behavior stay unified. Three installers or build flavors would multiply paths that can drift and require every release problem to be diagnosed across several artifacts.

“One application” does not mean “only change what the browser displays.” A profile must be enforced on the server:

- page layouts and API routes reject disabled domains;
- capability checks authorize every protected operation;
- database queries apply the profile's ownership scope;
- background jobs verify the initiating principal and target;
- navigation and terminology reflect the same server-resolved profile;
- administrators cannot enable a hidden client control to bypass a disabled domain.

Profile-specific large assets remain optional. For example, pipeline packages, reference databases, instrument integrations, and import tools should be downloaded or configured only when the selected profile/modules require them. This preserves one application artifact without forcing every installation to provision every operational dependency.

Separate artifacts should be reconsidered only if a future hard requirement demands different operating-system dependencies, independent release schedules, legally incompatible distribution, or a high-assurance deployment that cannot contain dormant code. None of the three current experiences requires that complexity.

## Why this separation is needed

The current application has the beginnings of the desired split, but the boundaries are incomplete:

- `src/lib/app-surface.ts` already selects `lab` or `workbench`, and the dashboard, root redirect, and sidebar respond to it.
- `src/app/(dashboard)/(workbench)/workbench` and `src/lib/workbench` already provide private workspaces, a canvas, datasets, import jobs, and an importer registry.
- The current Workbench has one concrete importer (`ncbi-genomes-taxon`). Runs and results are mostly placeholders, and pipeline execution is still designed around an `Order` or `Study`.
- `PipelineRun`, pipeline result selection, input resolution, and output write-back directly reference order/study/sample records.
- Authorization is distributed through direct `FACILITY_ADMIN` and `RESEARCHER` comparisons. At the time of this review, those comparisons appear in 159 non-test files, including 120 API files.
- The existing feature-module system controls mostly form, validation, access, and communication additions. It cannot safely express a different product shell, resource ownership model, or authorization policy.
- `NEXT_PUBLIC_SEQDESK_APP_SURFACE` makes the current surface partly a build-time concern. A canonical server-resolved profile is needed so page access, API access, navigation, and installation metadata cannot disagree.

The main design issue is that the current `role` value combines two independent concepts:

- **system administration**: who may manage users, secrets, updates, storage, and infrastructure;
- **workflow responsibility**: who may receive samples, manage sequencing, execute analysis, and publish results.

Those concepts happen to align in a large sequencing center, but they do not align in a small shared lab or a personal research workbench.

## Target experiences

| Concern | Sequencing Center | Shared Lab | Research Workbench |
| --- | --- | --- | --- |
| Primary users | Researchers and facility operators | Members of one lab/team | Individual researchers or research teams |
| Primary objects | Orders, studies, samples, sequencing runs | Projects/orders, samples, sequencing runs | Workspaces, datasets, analyses, runs, results |
| Default data entry | Sequencing request and sample intake | Direct sample/project creation | Upload, server files, URL, ENA/SRA/NCBI, prior results |
| Ownership | Requester-owned, facility-wide operator view | Shared operational workspace | Private or explicitly shared workspace |
| Handoff | Researcher submits; facility processes | No requester/facility handoff | No sequencing-service handoff |
| Operational permissions | Depend on workflow role | All members can perform normal lab work | Members operate on their own/shared workspaces |
| System settings | Installation admins only | Installation owner/admin only | Installation owner/admin only |
| Communication/tickets | Useful and enabled by default | Optional/off by default | Not part of the core profile |
| Sequencing integration | Core | Core | Optional data source, not the organizing model |
| Public repository publishing | Facility/broker-oriented | Optional | Researcher-oriented and optional |

### Important Shared Lab rule

“No researcher/admin differentiation” should apply to scientific and operational work, not to installation secrets or destructive administration. A Shared Lab member should be able to create and edit shared projects, attach data, manage sequencing runs, and launch pipelines. Only an installation owner/admin should manage accounts, credentials, updates, storage roots, and global configuration.

Making every user a `FACILITY_ADMIN` would be quick, but it would also expose infrastructure and secret-bearing settings. The capability model below avoids that.

### Agreed account model

All profiles use the same sign-in screen and account mechanism. “Login type” is not selected at sign-in; permissions are attached to the authenticated account.

| Profile | Normal account | Elevated account | Scientific/operational behavior |
| --- | --- | --- | --- |
| Sequencing Center | Researcher | Facility Operator and Administrator | Researchers manage their requests; operators process facility work; administrators configure the installation |
| Shared Lab | Member | Administrator | Every member can perform normal shared-lab sequencing and analysis work; administrators additionally configure the installation |
| Research Workbench | Member | Administrator | Members operate on their own or shared workspaces; administrators configure the installation and do not automatically receive access to private research data |

For Shared Lab specifically:

- registration does not ask the user to choose “researcher” or “facility admin”;
- the first account becomes an administrator;
- administrators can promote or demote other accounts, so more than one administrator is supported;
- the final administrator cannot be demoted or deleted until another administrator exists;
- members can create and edit shared projects, samples, sequencing runs, data attachments, analyses, and workflow runs;
- only administrators can manage accounts, installed/enabled pipeline packages, shared workflow catalog entries, instruments, storage roots, credentials, software updates, and global settings;
- members may create personal workflows and select run parameters; “configure workflows” in the administrator sense means controlling the installation-wide approved catalog and defaults.

“All scientific/operational work” excludes installation-wide destructive and code-installation actions. Members can use approved pipelines and work with shared data, but installing an arbitrary pipeline package is equivalent to granting code execution on the SeqDesk host. Permanent purge of shared raw data/results, cancellation of another user's active job, and changes to compute quotas or retention policy require separate capabilities and should be administrator-only by default. Recoverable archive/trash actions can be granted more broadly.

The first implementation can map current roles through the capability layer (`RESEARCHER` -> member and `FACILITY_ADMIN` -> administrator/operator) without immediately rewriting stored users. An additive schema migration can later separate `systemRole` (`MEMBER` or `ADMIN`) from an optional facility workflow role (`REQUESTER` or `OPERATOR`).

## Architecture

### 1. Introduce a deployment-profile layer

Add a small server-safe package, for example:

```text
src/lib/deployment-profile/
  types.ts
  definitions.ts
  resolver.ts
  capabilities.ts
  guards.ts
  navigation.ts
```

Use stable identifiers:

```ts
type DeploymentProfileId =
  | "sequencing-center"
  | "shared-lab"
  | "research-workbench";
```

Each profile definition should declare:

- product family and default landing route;
- enabled top-level domains;
- workflow policy and ownership scope;
- role-to-capability grants;
- navigation contributions;
- terminology/copy overrides;
- compatible optional modules;
- setup and registration behavior.

Resolve the active profile once on the server, using the existing configuration precedence rules. Persist the chosen profile in `settings.json`/install-profile configuration and mirror it in `SiteSettings.extraSettings` only when database editing is deliberately supported. Expose a sanitized resolved profile to client components through the dashboard layout. Do not make authorization depend on a `NEXT_PUBLIC_*` value.

For the migration period, translate the existing values as follows:

- current `lab` surface -> `sequencing-center`;
- current `workbench` surface -> `research-workbench`;
- `NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY` -> deprecated compatibility alias.

The profile should be restart-required initially. Changing profiles on an installation with existing data can hide workflows or change access scope, so an unrestricted settings toggle is unsafe. A future guarded migration command can support deliberate transitions.

The installer and updater remain profile-neutral. Installation writes the selected profile into canonical configuration, and the application resolves it at runtime. Updating SeqDesk replaces the shared application release while preserving the installation's selected profile and profile-managed settings.

For the first supported release, treat the profile as an **installation identity**, not as a per-user view switch. One installation has one active profile. Do not expose live profile switching in the web UI. A later administrative migration command may support selected transitions only after it performs a backup/preflight, reports permission and visibility changes, and confirms that no incompatible jobs are active.

### 2. Separate profiles, domains, feature modules, and capabilities

Use four distinct layers:

1. **Profile**: selects the application-wide experience.
2. **Domain**: a cohesive business area with routes, services, navigation, and data ownership.
3. **Feature module**: an optional feature inside a compatible domain.
4. **Capability**: a server-enforced permission to perform an action.

Recommended domains:

- `core`: authentication, accounts, settings, storage, jobs, notifications, updates;
- `facility-intake`: orders, configurable intake forms, requester handoff, departments, tickets;
- `sample-catalog`: samples, metadata, studies/collections, files, provenance;
- `sequencing-operations`: run planning, instruments, barcodes, discovery, live ingest, delivery;
- `analysis`: pipeline catalog, execution, monitoring, artifacts, result selection;
- `publishing`: ENA and future repositories;
- `workbench`: workspaces, datasets, imports, canvas, researcher runs and results.

The existing module flags such as `mixs-metadata`, `billing-info`, `notifications`, and `dynamic-studies` remain feature modules. They should gain compatibility metadata instead of being used to approximate a deployment profile. For example, `billing-info` belongs to `facility-intake`, while an importer belongs to `workbench` or `sample-catalog`.

### 3. Replace raw role checks with capabilities

Introduce a central authorization API and migrate server routes before changing role names:

```ts
await requireCapability(session, "sequencing.runs.manage", { orderId });
const scope = await getResourceScope(session, "orders.read");
```

Initial capability groups:

- `system.settings.manage`
- `system.users.manage`
- `system.updates.manage`
- `orders.create`, `orders.read`, `orders.read_all`, `orders.process`
- `studies.create`, `studies.read`, `studies.read_all`, `studies.publish`
- `samples.manage`
- `sequencing.runs.manage`, `sequencing.files.manage`, `sequencing.deliver`
- `analysis.run`, `analysis.read_own`, `analysis.read_all`, `analysis.resolve_outputs`
- `workbench.use`, `workbench.import`, `workbench.run`
- `publishing.submit`

Default grants:

| Principal | Sequencing Center | Shared Lab | Research Workbench |
| --- | --- | --- | --- |
| Member/current `RESEARCHER` | Own requests, studies, and published results | Shared scientific/operational work, including runs | Own/shared workspace data and runs |
| Owner/current `FACILITY_ADMIN` | Facility operations plus system administration | Same operational access plus system administration | Workspace access plus system administration |

Resource scope must remain part of authorization. A capability answers what a principal may do; a scope answers which records they may do it to (`own`, `department`, `workspace`, or `installation`).

During migration, keep the database `role` strings for compatibility but prohibit new direct comparisons outside the authorization package. Once route coverage is complete, migrate toward explicit system roles such as `OWNER`, `ADMIN`, and `MEMBER`. Workflow behavior should come from the deployment profile and resource membership, not from system role names.

Authorization changes must take effect promptly. The current JWT-based session carries the role assigned at login, so promotion, demotion, deactivation, or profile-policy changes need a server-validated authorization revision or forced session renewal. A demoted administrator must not retain administrator access until an old session naturally expires.

### 4. Compose navigation and route access by domain

Build navigation from profile/domain contributions rather than conditionals scattered through `DashboardShell` and `Sidebar`.

Each domain should contribute:

- list/detail routes;
- sidebar items and contextual navigation;
- page-title resolution;
- optional settings links;
- route availability metadata.

Add server-side guards at route-group layouts and API handlers. Hiding a link is not access control.

Suggested route families:

```text
/(facility)/orders
/(facility)/studies
/(sequencing)/sequencing-runs
/(analysis)/analysis
/(workbench)/workbench
/(admin)/admin
```

Next.js route groups need not change public URLs. Move files only when it improves ownership; begin with guards and registries to reduce churn.

Profile-specific landing routes:

- Sequencing Center: `/orders`
- Shared Lab: `/orders` initially, with neutral “Projects” or “Sequencing Work” language evaluated in user testing
- Research Workbench: `/workbench/data`

### 5. Make the pipeline engine target-agnostic

The execution engine should consume a resolved input bundle, not know how an order, study, or workbench canvas stores data.

Define a target adapter contract:

```ts
type PipelineTarget =
  | { type: "order"; id: string }
  | { type: "study"; id: string }
  | { type: "workbench-analysis"; id: string };

interface PipelineTargetAdapter {
  authorize(principal: Principal, action: PipelineAction): Promise<void>;
  resolveInputs(request: RunRequest): Promise<ResolvedInputBundle>;
  describe(): Promise<TargetDisplayMetadata>;
  publishOutputs(result: ResolvedRunOutputs): Promise<void>;
}
```

The shared execution core remains responsible for validation, configuration snapshots, Nextflow launch, status/events, logs, cancellation, and artifact discovery. Target adapters are responsible for ownership, semantic input selection, and domain-specific write-back.

Database evolution should be additive:

1. Add a Workbench target relation or a small `PipelineRunTarget` record while retaining `studyId` and `orderId`.
2. Route all new execution through the adapter boundary.
3. Backfill a canonical `targetKey` for existing runs.
4. Remove assumptions that exactly one of `studyId` or `orderId` must be present.
5. Keep facility-specific write-backs (`Read`, `Assembly`, `Bin`, preferred result selection) in facility adapters. Workbench outputs become datasets/artifacts in the user's workspace.

This is the key reuse point: all profiles share the pipeline runtime without forcing Workbench data into fake sequencing orders.

### 6. Complete the researcher data model

Build on the existing `WorkbenchWorkspace`, `WorkbenchAnalysis`, `WorkbenchDataset`, and import-job models. Do not reuse `Order` as a generic project.

Generalize `WorkbenchDataset` beyond reference-genome bundles. It currently includes provider-specific fields such as `genomeCount`; new datasets need typed, provenance-aware assets:

- dataset kind: reads, assembly, reference, annotation, table, report, or bundle;
- one or more assets with path, media/file type, size, checksum, and logical role;
- sample sheet or sample/lane/pair metadata where relevant;
- source provider, source URI/accession, request parameters, retrieval time, tool/provider version, and license where known;
- validation state and compatibility with pipeline input slots;
- owner/workspace visibility and lifecycle state.

An initial JSON manifest is acceptable for an MVP, but paths, ownership, and checksums must remain server-controlled. Normalize assets into their own table when querying individual assets or enforcing retention becomes important.

The Workbench object flow should be:

```text
Workspace -> Dataset(s) -> Analysis/canvas -> Pipeline run(s) -> Result dataset(s)
```

### 7. Make data inputs provider-driven

Retain and expand the existing Workbench importer interface. Provider descriptors should declare input schema, output dataset kinds, prerequisites, preview support, resumability, and network/local-storage requirements.

Prioritized input providers:

1. **Upload from browser**: FASTQ/FASTA and supported archives, resumable for large files, with checksum and quota/free-space checks.
2. **Import from configured server path**: selectable only beneath administrator-approved roots; never accept an arbitrary client-supplied path.
3. **ENA/SRA accession import**: preview metadata and retrieve real records through supported tools/APIs.
4. **NCBI datasets**: generalize the existing taxon genome importer.
5. **HTTP(S) URL import**: strict scheme allowlist, DNS/IP protections, redirects revalidated, size limits, and checksums to prevent SSRF and storage abuse.
6. **Reuse prior SeqDesk results**: attach an existing compatible result dataset without copying when policy permits.

Importers should create immutable provenance records and materialize datasets through one shared service. They should not write directly to arbitrary domain tables.

### 8. Profile-aware setup, registration, and language

The setup flow should ask for the deployment profile before profile-specific configuration.

- Sequencing Center: facility identity, first facility administrator, researcher registration/invites, intake forms, sequencing storage and instruments.
- Shared Lab: lab identity, first owner, member invitations/registration, shared data scope, sequencing storage and instruments.
- Research Workbench: workspace identity, first owner, data/import storage, pipeline runtime; no facility name or sequencing-order copy.

Copy should come from profile/domain terminology where meaning differs. Do not scatter ternaries across pages. Keep underlying entity names stable during the first implementation phase; introduce display labels through the profile definition.

Public API field names, database identifiers, exported manifests, and automation contracts should remain stable when only display terminology changes. For example, showing “Project” in Shared Lab must not silently rename `orderId` in an existing API.

## Account lifecycle and data stewardship

Profile design must define what happens when a person leaves. Scientific records should belong to the installation/workspace, while `createdBy` and ownership fields preserve provenance and access responsibility.

- Default to account deactivation rather than hard deletion.
- Revoke sessions, API credentials, and queued privileged actions when an account is deactivated or demoted.
- Shared Lab records remain available to the lab when their creator leaves.
- Private Workbench resources require an explicit transfer, export, retention, or purge decision before their owner can be deleted.
- Administrators do not automatically gain access to private Workbench data; any support-access mechanism must be explicit, time-limited, and audited.
- Never cascade-delete a research workspace merely because an administrator removed a login.
- Keep immutable creator/actor information even when operational ownership is transferred.

The application also needs a secure recovery path if normal administrator access is lost. Provide a local CLI operation, available only to an operator with installation filesystem/database access, that can promote or recover an administrator and records the recovery event. This is separate from browser registration and must not accept a remote unauthenticated request.

First-administrator creation must also be protected. The installer should create the initial administrator from locally supplied bootstrap credentials or issue a short-lived, single-use bootstrap token. Do not make “the first browser registration becomes administrator” available on an externally reachable unclaimed server. Initial claiming and the final-administrator invariant must be atomic so two concurrent requests cannot create an unsafe state.

## Profile and module compatibility

Every domain and feature module should declare the profiles it supports, required capabilities, dependencies, and conflicts. Validate the complete configuration at installation, reload, startup, and before an administrator saves changes. Invalid combinations must fail closed with an actionable message; they must not silently enable a dependency or fall back to Sequencing Center.

Examples:

- `billing-info` requires the facility-intake domain;
- sequencing-run assignment requires sequencing operations and sequencing technology;
- Workbench import providers can require optional command-line tools or network access;
- ENA broker submission is a facility-oriented publishing configuration, while personal repository import/export uses user-scoped credentials.

## Recommended implementation phases

### Phase 0 — Freeze behavior with characterization tests

- Add a profile/route/capability inventory test describing current Sequencing Center behavior.
- Add authorization tests for representative researcher and facility-admin paths.
- Record current root redirects, navigation, registration, order visibility, pipeline creation, and settings access.
- Add a Workbench smoke test covering workspace creation, NCBI preview/import, canvas persistence, and ownership isolation.

Exit condition: the current application behavior can be refactored without relying on manual regression detection.

### Phase 1 — Profile foundation, with no visible behavior change

- Add the deployment-profile types, definitions, server resolver, and sanitized client context.
- Add `deployment.profile` to application and install-profile configuration coverage.
- Map legacy `lab` and `workbench` environment values.
- Centralize landing-route selection, page-title selection, sidebar selection, and route-group guards.
- Keep one release artifact and teach the existing installer to select/persist a profile interactively or through hosted configuration.
- Keep `sequencing-center` as the default.

Exit condition: one canonical profile drives server and client behavior; existing lab and Workbench surfaces still behave as before.

### Phase 2 — Central authorization and domain boundaries

- Add `Principal`, capability, scope, and `requireCapability` helpers.
- Convert the highest-risk write APIs first: users/settings, pipeline creation/start/cancel/output resolution, sequencing file operations, publishing, and deletes.
- Convert list/read filters to centralized scope builders.
- Add a lint rule or repository test that rejects new raw role comparisons outside compatibility/auth code.
- Introduce domain navigation registries and route guards.

Exit condition: profile work no longer requires duplicating role checks, and UI visibility matches server authorization.

### Phase 3 — Shared Lab profile

- Add `shared-lab` profile defaults and setup option.
- Grant members installation-wide scientific/operational scope while retaining owner-only system administration.
- Remove the requester/facility handoff from the Shared Lab UI; simplify status actions and hide tickets/departments by default.
- Use shared ownership filters in orders, studies, samples, sequencing, analysis, and sidebar counts.
- Add neutral terminology where it improves comprehension without changing stored data.
- Provide a tested `sequencing-center -> shared-lab` transition that preserves all records and can be reversed while no Shared Lab-only access changes are pending.

Exit condition: two ordinary lab members can see and operate the same sequencing work, while neither can access owner-only secrets or infrastructure controls.

### Phase 4 — Research Workbench data foundation

- Generalize dataset manifests and provenance.
- Add browser upload and approved-server-path providers.
- Add ENA/SRA import and broaden NCBI import.
- Complete Imports and Data views, quotas/free-space handling, cancellation, retry, and cleanup.
- Add workspace membership only if shared research workspaces are required for the first release; otherwise keep the current private workspace and design the schema additively.

Exit condition: a researcher can create a usable dataset without creating an order or study.

### Phase 5 — Workbench pipeline execution and results

- Add the pipeline target adapter boundary.
- Extend run persistence for Workbench analyses.
- Validate dataset manifests against pipeline semantic input requirements.
- Execute canvas pipeline nodes through the shared runtime.
- Materialize outputs as workspace result datasets with provenance links.
- Complete Runs and Results views and connect them to the canvas.

Exit condition: a researcher can import/upload data, run a real packaged pipeline, inspect progress, and retrieve results entirely inside Workbench.

### Phase 6 — Physical modularization and cleanup

- Move domain services/components into clear packages after their interfaces are stable.
- Remove legacy app-surface aliases after an announced deprecation window.
- Migrate stored system roles if still valuable; otherwise retain the strings behind the centralized principal adapter.
- Remove order/study assumptions from shared pipeline runtime code.
- Update help, demos, seed data, installer profiles, and release-test matrices for all supported profiles.

Exit condition: profile-specific code is owned by its domain, shared infrastructure has no facility-specific assumptions, and all profiles are release-gated.

## First implementation slice

The safest first pull request from this plan should be deliberately small:

1. Add `DeploymentProfileId`, the three profile definitions, and a server resolver.
2. Default to `sequencing-center` and preserve the two legacy environment aliases.
3. Pass the resolved profile through the dashboard shell.
4. Replace existing app-surface decisions in the root redirect, Workbench layout guard, dashboard shell, and sidebar.
5. Add config/install-profile coverage and focused tests.
6. Do not yet expose `shared-lab` in production setup or change authorization.

That slice creates the seam needed for later work without presenting a profile whose permissions are not ready.

The second slice should introduce the capability API and convert one complete vertical path—pipeline run listing/creation/start plus its UI—before converting the rest of the application.

## Migration and compatibility

- Existing installations resolve to `sequencing-center` unless explicitly configured otherwise.
- Existing installations and all three profiles use the same release artifact, installer, database migration chain, updater, and rollback mechanism.
- No order, study, sample, sequencing, or pipeline-run data is rewritten merely by introducing profiles.
- Legacy environment settings continue to resolve with a deprecation warning.
- Profile changes are recorded with actor, timestamp, previous profile, and new profile.
- Moving to Research Workbench does not delete facility data. Facility routes are disabled, and returning to the prior profile restores access.
- Profile changes must never silently broaden access. The transition service previews changes in visibility and permissions before applying them.
- Existing `RESEARCHER`/`FACILITY_ADMIN` values remain valid until all server authorization is capability-based.

## Security and operational requirements

- Enforce profile/domain access in APIs and server layouts, not only navigation.
- Keep system administration owner-only in Shared Lab and Workbench.
- Validate all local paths against configured roots and canonicalize them after resolving symlinks.
- Protect URL import against SSRF, redirect bypasses, excessive downloads, and archive expansion attacks.
- Apply upload quotas, free-space checks, extension/content validation, checksums, cancellation, and cleanup of abandoned partial files.
- Preserve immutable provenance from source input through pipeline outputs.
- Treat dataset sharing and cache reuse separately: identical bytes may share storage internally without granting cross-workspace access.
- Ensure background jobs re-check target ownership/capabilities when queued and record the initiating principal.
- Do not expose secrets or operator-only filesystem paths in Workbench API responses.
- Invalidate or re-authorize active sessions after account-level or profile-level permission changes.
- Prefer account deactivation and explicit resource transfer over destructive user deletion.
- Separate installation credentials from user-owned repository/file-source credentials.
- Audit profile changes, administrator recovery, permission changes, support access, credential changes, and destructive data operations.
- Treat pipeline/package installation as privileged code installation; ordinary members may run only administrator-approved packages.
- Separate reversible archive/trash from permanent purge, and protect shared-data purge with a dedicated capability and audit record.
- Apply administrator-configured compute, concurrency, storage, and retention limits even when every Shared Lab member may launch workflows.
- Block profile migration while incompatible imports, uploads, sequencing streams, or pipeline jobs are active.
- Back up and restore the database, canonical configuration, secrets, installed pipeline metadata, and managed data roots as a coherent installation; verify the restored profile before starting workers.

## Test and release matrix

Every profile should have a small mandatory end-to-end journey:

- Sequencing Center: researcher creates/submits an order; operator receives/processes it; researcher sees published output.
- Shared Lab: member A creates work; member B manages sequencing/runs; both see the shared result; neither accesses system settings.
- Research Workbench: researcher imports or uploads a real small dataset, runs a lightweight real pipeline, and downloads/views the result.

Additionally require:

- table-driven capability tests for profile x principal x action x scope;
- route reachability tests for profile x route family;
- API tests proving hidden domains return 404/403 as defined;
- cross-user/workspace isolation tests;
- legacy configuration and existing-installation migration tests;
- clean-install tests for one install profile per deployment profile;
- pipeline runtime tests proving facility and Workbench adapters produce equivalent execution inputs where appropriate.

## Remaining product decisions before Phase 3/4

These choices do not block the foundation work, but they should be answered before exposing new profiles:

1. Should “Sequencing Order” be relabeled as “Project” in Shared Lab, or is the order terminology still useful?
2. Is the first Workbench release single-user/private-workspace only, or must shared team workspaces ship immediately?
3. Which researcher input is the first must-have after NCBI genomes: browser upload, server-path import, or ENA/SRA accessions?

Already decided: Shared Lab work is shared by default, subject to separate destructive-action permissions, and one installation exposes one deployment profile. Recommended answers for the remaining questions are: keep stored `Order` but test a neutral display label, ship private Workbench first, and implement browser upload plus ENA/SRA next.

## Explicit non-goals for the first milestones

- Rewriting all existing pages or renaming all database models.
- Creating separate application builds, tarballs, npm packages, installer copies, or updater channels for the three profiles.
- Making every Shared Lab user an installation administrator.
- Faking Workbench datasets as sequencing orders.
- Supporting arbitrary local filesystem paths supplied by a browser.
- Supporting multiple deployment profiles concurrently in one installation.
- Replacing the existing packaged Nextflow runtime.
- Moving code between the SeqDesk, SeqDesk.com, and MetaxPath repositories without a separately approved compatibility change.
