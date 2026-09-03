# Profile-aware installation and setup journey

Status: in progress on `codex/modular-deployment-modes`

Companion to:

- `docs/architecture/deployment-profiles-plan.md`
- `docs/architecture/deployment-profiles-decision-register.md`
- `docs/architecture/deployment-profiles-todo.md`

## Outcome

A new operator should be able to install SeqDesk without already understanding its internal domains, configuration hierarchy, or historical “lab/workbench” terminology. The installer should explain the choice in terms of how the team works, recommend safe defaults, omit irrelevant questions, validate the complete plan before making changes, and end with profile-specific next steps.

SeqDesk still has one release artifact and one canonical installation engine. Interactive, unattended, and hosted installs differ only in where their answers come from:

```text
guided answers ----+
JSON/CLI values ----+--> normalized InstallPlan --> validate --> preview --> apply --> verify
hosted profile -----+
existing config ----+
```

This avoids implementing three installers or allowing the interactive wizard, hosted profiles, and automation to drift into different behavior.

## Current branch checkpoint

The branch already keeps one release and one canonical installer, requires an
explained profile choice in a fresh guided install, collects a local/team/custom
access topology, defaults the application listener to loopback, recommends and
validates profile-aware storage outside the application tree, recommends
workflow-runtime setup based on the profile, creates one secure administrator,
and disables the generic second account. Guided and configured values now
converge into a schema-versioned, redacted `InstallPlan`; the same plan renders
the pre-apply review and `--plan --json`. PostgreSQL provisioning, Conda setup,
release download, and application writes begin only after that review is
confirmed. Unattended installs still default to Sequencing Center only as a
compatibility fallback and warn operators to pass `--deployment-profile`
explicitly.

That is not yet the finished installer architecture. Before the three profiles
are advertised as fully supported, the remaining high-priority work is hosted
lock/source fidelity in the plan, strict no-temporary-file preview handling for
remote configuration, mount/capacity and executor-specific preflight,
reconfiguration diffs, and automatic resume from recorded apply checkpoints.
Existing targets are
now classified before the fresh-install questions and routed to update,
reconfigure, diagnosis, or safe refusal. New installs opt into a versioned,
administrator-only onboarding checklist; legacy installs are not unexpectedly
blocked, and ordinary members see a safe setup-in-progress state until required
onboarding is complete.

## Current behavior worth preserving

The existing installer already contains useful safety patterns:

- it distinguishes fresh installation, reconfiguration, and update behavior;
- it checks the install target, supported runtime, disk space, release integrity, and PostgreSQL availability;
- it asks account questions only after the selected database can be checked;
- it redacts database credentials in summaries;
- it can generate a strong bootstrap password and displays it only after successful account creation;
- it backs up an existing target during deliberate replacement and prints recovery information after failure;
- it has `seqdesk doctor`, setup status, hosted install profiles, and non-interactive configuration paths.

## Remaining experience gaps

The profile work should fix these gaps rather than layering another question onto the current flow:

- The interactive experience is split between shell prompts for database/accounts and `scripts/install-wizard.mjs` for port/configuration review.
- The installer still defers most storage configuration instead of collecting and validating profile-aware managed roots before installation.
- The browser `/setup` page reports base database/schema/account readiness but does not yet represent profile-specific operational readiness.
- There is no side-effect-free way to preview the final resolved installation plan before applying it.

## Installation entry points

Keep three supported entry points, all feeding one validator and application engine:

1. **Guided install**: recommended for people installing SeqDesk themselves.
2. **Unattended install**: explicit CLI/JSON values for automation and reproducible deployments.
3. **Hosted install profile**: an administrator-provided configuration bundle with managed/locked values.

The public documentation should lead with the guided install. Advanced flags and raw JSON belong under an “Automated or managed installation” section, not in the beginner path.

### Existing installation detection

Before asking setup questions, resolve the target directory and classify it:

- **new target**: start the fresh-install journey;
- **existing SeqDesk installation**: offer Update, Reconfigure, Diagnose, or Cancel;
- **non-SeqDesk non-empty directory**: stop and explain how to choose another directory or deliberately back up/replace it;
- **partial/failed SeqDesk installation**: show the detected checkpoint and the safe Resume, Restore, Diagnose, or Start over choices.

Do not ask an existing installation to choose its deployment profile again. Update preserves it; reconfiguration shows it as read-only; changing it belongs to the future guarded profile-migration command.

## Guided fresh-install journey

### Step 0 — Fail fast on basic prerequisites

Before collecting configuration, run a read-only eligibility check for operating system/architecture, Node.js/npm, required release/checksum tools, target-parent writability, obvious port conflicts, and coarse free space. Explain one corrective action and exit before asking the user to complete the wizard when a hard prerequisite is missing.

Choice-dependent checks such as database credentials, exact storage capacity, Conda/Nextflow, Slurm, external connectivity, and package download sizes run after the relevant answer is known but still before material installation changes.

### Step 1 — Explain and select the application mode

Use “How will your team use SeqDesk?” rather than “Choose a product variant.” A fresh interactive install requires an explicit selection; do not silently preselect Sequencing Center.

| Choice | Short installer description | Select this when |
| --- | --- | --- |
| **Sequencing Center** | People request sequencing work and facility staff receive, process, and deliver it. | Requesters and the people operating the sequencing service are different groups. |
| **Shared Lab** | One lab shares sequencing projects, samples, runs, and analyses. Administrators additionally manage the installation. | The same team creates and performs the work, without a requester-to-facility handoff. |
| **Research Workbench** | Researchers import or upload existing data, run workflows, and organize results in workspaces. | Analysis is primary; sequencing orders and facility handoffs should not organize the UI. |

Always show this note:

> This choice changes workflows, permissions, navigation, and setup recommendations. It does not install a different SeqDesk build. Changing it later requires a reviewed migration, not a view switch.

Add a concise “Not sure?” decision helper:

- Do outside researchers submit requests to your team? Choose **Sequencing Center**.
- Does one lab team create and process its own sequencing work? Choose **Shared Lab**.
- Are you mainly bringing existing data into analyses? Choose **Research Workbench**.

### Step 2 — Choose how the installation will be accessed

Ask a human question before exposing bind addresses and authentication URLs:

| Choice | Recommended behavior |
| --- | --- |
| **Only on this computer** | Bind to loopback, use a localhost URL, and recommend manual start for evaluation or a user service for persistent personal use. |
| **On a team server** | Ask for the canonical HTTPS URL, explain the reverse-proxy/TLS responsibility, and recommend a persistent service plus backups. |
| **Advanced/custom** | Reveal bind address, port, proxy, database, and service-manager controls. |

The browser URL, bind host, and health-check URL are separate values. Never turn a loopback default into a network listener merely because a non-local browser URL was entered. Require explicit acknowledgement for a non-loopback bind, and do not describe a plain-HTTP network deployment as production-ready.

### Step 3 — Choose and verify PostgreSQL

Keep two primary choices:

- **Local PostgreSQL (recommended for evaluation or one-server installs)**: reuse a healthy compatible local service when safe, otherwise provision SeqDesk's private instance where supported.
- **Existing/managed PostgreSQL**: accept runtime and direct migration URLs, redact them in all output, and test both the network endpoint and authenticated migration capability before continuing.

Explain the tradeoff next to the choices:

- local is the fewest decisions and keeps everything on one machine;
- existing/managed fits institutional backup, availability, and database-operation policies;
- the installer can verify reachability and schema permissions, but it cannot guarantee the operator's backup policy.

Perform this preflight before requesting or generating account passwords. A database that already contains SeqDesk data must be classified as adoption/reconfiguration, and its existing accounts must never have their passwords silently replaced.

### Step 4 — Configure profile-aware storage

Offer **Use recommended managed locations** first and place advanced path fields behind a second choice.

| Profile | Primary storage label | Additional paths shown when relevant |
| --- | --- | --- |
| Sequencing Center | Sequencing data | Pipeline runs, pipeline databases/cache, delivery/export area |
| Shared Lab | Shared sequencing and analysis data | Pipeline runs, pipeline databases/cache, import staging |
| Research Workbench | Managed datasets | Upload/import staging, pipeline runs, pipeline databases/cache |

For every selected path, show whether it will be created, already exists, is writable, is local/network storage, and how much free space is visible. Reject `/`, the home directory itself, the installation root itself when unsafe, nested roots that would be backed up or counted twice, symlink escapes, and an unavailable configured mount.

The default layout may use distinct subdirectories beneath one operator-selected data root. Explain that changing storage paths later does not move data automatically and should be treated as a data migration.

### Step 5 — Configure workflow execution only when relevant

Ask whether to prepare workflow execution now:

- Sequencing Center: optional; explain that order/sample management works without it.
- Shared Lab: recommended but optional if the team initially uses only sequencing tracking.
- Research Workbench: recommended and required for full operational readiness, because analysis is the profile's purpose.

If enabled, ask:

1. **Local execution** or **Slurm**;
2. whether to provision/reuse the supported Conda/Nextflow runtime;
3. which approved starter pipeline packages to install, showing estimated download/storage size;
4. whether to run a small real smoke test after installation.

Keep executor details, queues, memory, cluster options, caches, and private package credentials under Advanced unless a hosted profile supplies them. A deployment profile never directly selects a Nextflow profile.

### Step 6 — Create the first administrator and choose enrollment policy

Create exactly one administrator during a normal fresh guided install. Do not create a generic second “researcher” account.

Ask for:

- administrator name and email;
- a password, with **Generate a strong password** as the recommended option;
- the enrollment policy, preselected from the deployment-profile default.

Explain the administrator's role using profile-aware text:

- Sequencing Center: configures the installation and may also be assigned facility-operator work.
- Shared Lab: can do the same normal lab work as members and additionally manages accounts, storage, pipelines, credentials, and updates.
- Research Workbench: manages the installation but does not automatically gain access to another member's private workspace.

Recommended enrollment defaults:

- Sequencing Center: researcher self-registration enabled, with optional domain restriction/verification;
- Shared Lab: invite-only;
- Research Workbench: invite-only.

Do not ask for SMTP, OIDC, ENA, public-repository credentials, or additional accounts during the core installer. Those are easier to explain and test in authenticated onboarding. Hosted configuration may provide them non-interactively.

### Step 7 — Offer only relevant optional content

Keep this short:

- **Example data**: off by default on a team server; recommended only for a clearly labelled local evaluation. It must remain deterministic and explicitly synthetic/test data.
- **Telemetry**: off by default and separately consented.
- **Large reference databases/private pipeline packages**: show exact selected items and estimated sizes; never download all profile-compatible assets automatically.

Instrument connections, ENA submission credentials, file-source credentials, and module customization belong in post-login onboarding unless locked by a hosted install profile.

### Step 8 — Review the resolved plan

Show one review screen before any material write. Include:

- operation: fresh install;
- SeqDesk release/version and checksum status;
- deployment profile plus one-sentence workflow summary;
- access scope, canonical browser URL, bind address, and port;
- database mode and redacted endpoints;
- every storage/work/cache root with free-space result;
- workflow runtime/executor and selected package downloads;
- first administrator email and enrollment policy;
- service manager/start-on-boot behavior;
- optional example data and telemetry;
- hosted-managed values and which fields are locked;
- warnings and incomplete readiness items;
- estimated downloads and disk requirement where measurable.

Provide **Back**, **Save sanitized plan**, **Install**, and **Cancel**. Never show passwords, tokens, or full credential-bearing URLs in the plan. A hosted install must show which organization-controlled settings cannot be changed locally.

### Step 9 — Apply without asking new questions

After confirmation, do not surprise the user with more choices. Display progress using stable stages:

1. validate plan and acquire install lock;
2. prepare target/backup;
3. download and verify release;
4. install runtime dependencies;
5. configure and migrate PostgreSQL;
6. write protected configuration;
7. create the first administrator;
8. prepare storage/runtime/optional assets;
9. start the service when selected;
10. verify readiness.

Each stage reports pending/running/done/failed. The protected log may contain diagnostic detail but never secrets. The normalized plan, not the UI component, drives every mutation.

### Step 10 — Verify and hand off

Automatically verify what the installer claims:

- persisted deployment profile matches the selected value;
- PostgreSQL is reachable and migrations are current;
- exactly the intended bootstrap administrator exists and can authenticate;
- the application starts and reports the expected version/profile;
- storage roots exist and are writable by the runtime identity;
- workflow runtime and starter pipeline smoke test pass when selected;
- no known default credentials remain;
- the configured browser and local health URLs are reported distinctly.

Use honest completion states:

- **Installed and verified**;
- **Installed; start the service to finish verification**;
- **Installed; optional setup remains**;
- **Installation failed and previous state was restored/preserved**.

Do not print a generic success banner when the service was expected to start but cannot answer its health check.

The final next steps must be profile-specific:

| Profile | First successful journey |
| --- | --- |
| Sequencing Center | Log in, configure sequencing storage/instruments, invite or enable researchers/operators, and run a test order handoff. |
| Shared Lab | Log in, confirm shared storage/instruments, invite lab members, and complete one shared project from samples to result. |
| Research Workbench | Log in, confirm managed/upload storage and workflow runtime, import or upload a small dataset, and run a starter analysis. |

Display a generated administrator password only after successful account creation, exactly once, outside the log. Also print the local `reset-password` recovery command.

## One normalized InstallPlan

Define and version a server-independent plan structure. The exact field names can be refined during implementation, but it should cover:

```ts
interface InstallPlan {
  schemaVersion: number;
  operation: "install" | "reconfigure" | "update";
  release: { version: string; source: string; checksum?: string };
  deployment: { profile: DeploymentProfileId };
  access: {
    audience: "local" | "team-server" | "advanced";
    browserUrl: string;
    bindHost: string;
    port: number;
  };
  database: { mode: "local" | "existing"; runtimeUrlRef?: string; directUrlRef?: string };
  storage: {
    managedDataRoot: string;
    stagingRoot?: string;
    runRoot?: string;
    cacheRoot?: string;
  };
  execution: {
    prepareNow: boolean;
    executor?: "local" | "slurm";
    starterPackages: string[];
    runSmokeTest: boolean;
  };
  enrollment: { policy: "invite-only" | "self-registration"; allowedDomains?: string[] };
  bootstrap: { adminEmail: string; adminName: string; passwordRef: string };
  optional: { exampleData: boolean; telemetry: boolean };
  sources: Record<string, "default" | "answer" | "cli" | "config" | "hosted">;
  lockedPaths: string[];
}
```

Secret references point to protected ephemeral inputs or configured secret sources; a saved/sanitized plan never contains secret values. Validate unknown keys, incompatible profile/module combinations, URL/bind inconsistencies, storage overlap, and hosted locks before applying.

Add a `--plan` mode that resolves and validates the plan, prints or emits sanitized JSON, and exits before filesystem/database/service mutations. The review screen and `--plan` output must be generated from the same normalized representation.

## Browser setup status versus authenticated onboarding

These are separate concerns:

### Public setup status

`/setup` and `/api/setup/status` may safely report only whether the base application can reach its database, has a current schema, has a valid deployment profile, and has at least one active administrator. They must not create users, seed configuration, choose a profile, reveal account addresses, or apply hosted settings in response to an unauthenticated `GET`.

Move automatic seeding/account creation into the installer or an explicit protected startup operation. Keep the public response deliberately small and non-secret.

### Authenticated first-login onboarding

After the first administrator signs in, redirect to a profile-aware onboarding checklist until critical items are complete. It should use normal protected administration APIs and remain reopenable later.

Common checklist:

- confirm installation name/contact and selected deployment profile;
- verify storage;
- verify backup responsibility is acknowledged/documented;
- invite members or configure enrollment;
- review enabled modules and credentials;
- finish a small test journey.

Profile additions:

- Sequencing Center: facility identity, operators, intake form, sequencing technology/instruments, requester registration, delivery/publishing.
- Shared Lab: lab identity, shared work terminology, instruments, member invitations, pipeline catalog, retention/quotas.
- Research Workbench: managed/upload storage, import providers, workflow runtime/catalog, first private workspace, first import/run.

Track onboarding with a versioned checklist and explicit `completedAt`/actor rather than equating “a SiteSettings row exists” with complete setup. Critical infrastructure failures block the affected operation; incomplete optional onboarding should not prevent an administrator from signing in to fix it.

Ordinary members who arrive before operational setup is complete should see a clear “Your administrator is finishing setup” state, not broken navigation or administrator instructions.

## Reconfigure, update, and recovery behavior

### Reconfigure

- Load the existing normalized plan/configuration and show a diff before applying.
- Keep deployment profile read-only.
- Preserve accounts and scientific data; never seed generic users.
- Respect hosted-managed locks.
- Revalidate paths, database access, URL/bind pairing, runtime, and module compatibility.
- Explain when a restart is required and verify the restarted service.

### Update

- Preserve the deployment profile and operator configuration automatically.
- Do not run the fresh-install wizard.
- If a release introduces a new required setting, mark the relevant readiness item incomplete and direct an administrator to authenticated onboarding/reconfigure.
- Keep the existing tested update/rollback path and exact release artifact.

### Failure and retry

- Validate all detectable failures before writing.
- Record a non-secret stage/checkpoint so retry can continue safely or start from the last idempotent boundary.
- State exactly what changed, what was restored, what remains, and the single safest next action.
- Never recommend destructive cleanup as the generic retry path.
- If generated credentials were not applied, do not display them as valid credentials.
- If the database already contained an account, report that its password was preserved and provide the local reset command.

The installer now takes an exclusive per-target apply lock after confirmation
and records a schema-versioned, secret-free adjacent checkpoint through database,
release, configuration, and migration stages. It removes both after success and
keeps the checkpoint on failure for diagnosis. Automatic continuation from that
checkpoint remains future work; current retry paths either reuse idempotent work
or preserve a partial target before restarting setup.

## Documentation and copy rules

- Use the same profile descriptions in installer help, website documentation, configuration examples, and first-login onboarding.
- Give every question a one-sentence “why this is asked” explanation and mark one safe recommended choice where appropriate.
- Put rare technical settings behind Advanced sections.
- State which settings can be changed later, where, and whether changing them moves data or requires restart.
- Avoid “researcher” as the generic non-admin term outside Sequencing Center; use “member.”
- Avoid calling the hosted configuration or Nextflow execution choice merely “profile” when the deployment profile is visible in the same context.
- Do not claim external URL, SMTP, credentials, storage, Slurm, or backups were verified when the installer only checked syntax or reachability.

## Acceptance matrix

At minimum, automate these journeys against the same release artifact:

1. Fresh interactive Sequencing Center install using local PostgreSQL and no pipelines.
2. Fresh interactive Shared Lab install using local PostgreSQL and local pipeline runtime.
3. Fresh interactive Research Workbench install using existing PostgreSQL, managed storage, resumable-upload staging, and a starter pipeline smoke test.
4. Unattended install for each deployment profile from sanitized JSON.
5. Hosted install profile that locks the deployment profile and selected infrastructure settings.
6. Local-only versus team-server URL/bind validation.
7. Cancel from every wizard screen with zero material mutations before confirmation.
8. `--plan` produces a valid redacted plan and performs zero mutations.
9. Failure injection at download, checksum, database, migration, storage, seed, runtime, service start, and health verification stages.
10. Reconfigure preserves profile/accounts/data and presents the correct diff.
11. Update preserves profile/configuration and does not reopen fresh setup.
12. Existing/partial target offers the correct resume/restore/diagnose path.
13. Generated password is shown once only after successful creation and never enters logs or saved plans.
14. No supported packaged fresh install creates a known default password or generic second account.
15. `/api/setup/status` is read-only and cannot create an administrator or alter configuration.
16. First login and next steps use the selected profile's language and landing page.

Release checks should also assert that `scripts/install-dist.sh`, the npm launcher/help, the public installer copy, hosted install-profile schema, `settings.json` example, and website setup documentation describe the same choices and defaults.
