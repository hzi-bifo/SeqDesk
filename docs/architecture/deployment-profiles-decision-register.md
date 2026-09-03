# Deployment profiles pre-implementation decision register

Status: proposed defaults for confirmation

Companion to:

- `docs/architecture/deployment-profiles-plan.md`
- `docs/architecture/deployment-profiles-todo.md`

This register captures choices that are easy to hide inside implementation details but expensive to reverse after data, permissions, URLs, or installer contracts exist. It distinguishes decisions that must be fixed before the profile foundation from choices that can wait until Shared Lab or Research Workbench work begins.

## Priority legend

- **Foundation gate**: decide before Milestones 1-2 or the first schema/API contracts.
- **Installation gate**: decide before exposing a new profile in the guided, unattended, or hosted installer.
- **Shared Lab gate**: decide before exposing Shared Lab to users.
- **Workbench gate**: decide before generalizing Workbench data/imports.
- **Deferred**: preserve an extension point, but do not implement it in the first release.

## Recommended defaults at a glance

| ID | Gate | Recommended default |
| --- | --- | --- |
| F-01 | Foundation | Keep “deployment profile,” “hosted install profile,” and “Nextflow execution profile” as distinct concepts and identifiers. |
| F-02 | Foundation | One SeqDesk installation represents one organization/team and has one active deployment profile. |
| F-03 | Foundation | Shared Lab and Workbench use peer `MEMBER`/`ADMIN` system roles; there is no special permanent `OWNER` role. |
| F-04 | Foundation | Registration policy is profile configuration; Shared Lab and Workbench default to invite-only after secure administrator bootstrap. |
| F-05 | Foundation | Ownership follows the resource, not the creator: lab records are installation-owned and Workbench records are workspace-owned. |
| F-06 | Foundation | Return `404` for a domain absent from the active deployment profile and `403` for an available action the principal lacks. |
| F-07 | Foundation | The deployment profile is locally configured and restart-required; it is not initially editable in the database/UI. |
| F-08 | Foundation | Model human and machine principals separately; do not reuse a human admin account for automation. |
| F-09 | Foundation | Ship local credentials first while keeping authorization independent of the login provider; defer OIDC/LDAP. |
| F-10 | Foundation | Store installation administration and Sequencing Center responsibility independently; keep the legacy role only as a conservative rollback mirror. |
| I-01 | Installation | Fresh guided installs require an explicit, explained deployment-profile choice. |
| I-02 | Installation | Guided, unattended, hosted, and reconfigure paths resolve to one versioned `InstallPlan`. |
| I-03 | Installation | Ask local-only versus team-server access before exposing host/port/proxy details. |
| I-04 | Installation | Create one secure administrator, never known default credentials or a generic second account. |
| I-05 | Installation | Keep public setup status read-only; perform profile-aware onboarding after authenticated admin login. |
| I-06 | Installation | Verify base readiness automatically and report incomplete profile-specific operational readiness honestly. |
| I-07 | Installation | Updates preserve the profile; reconfigure previews a diff; profile changes use a separate future migration. |
| I-08 | Installation | Add a redacted, zero-mutation `--plan` mode before applying changes. |
| I-09 | Installation | Gate members only on required operational readiness; keep recommendations visible and reopenable without blocking work. |
| I-10 | Installation | Treat database/config/data backup and schema-compatible rollback as release gates, not optional post-install advice. |
| I-11 | Installation | Treat installer inputs and downloaded executables as a supply-chain boundary: strict schemas, protected secret sources, HTTPS, hashes, and pinned tool versions. |
| S-01 | Shared Lab | Use optimistic concurrency for shared edits and return a visible conflict instead of silently overwriting. |
| S-02 | Shared Lab | Keep shared scientific data after account deactivation; archive is reversible and shared purge is administrator-only. |
| W-01 | Workbench | Allow multiple private workspaces per user in the first release; add collaborative sharing later. |
| W-02 | Workbench | Separate workspace-owned logical datasets from immutable, deduplicated physical storage objects. |
| W-03 | Workbench | Represent samples and typed/nested asset collections explicitly, including paired reads and lanes. |
| W-04 | Workbench | Copy uploads and repository imports into managed storage by default; make approved-path linking explicit and read-only. |
| W-05 | Workbench | Treat data bytes and run snapshots as immutable; edits create metadata revisions or new derived datasets. |
| W-06 | Workbench | Use resumable upload sessions with storage reservation and cleanup, not a single large request. |
| W-07 | Workbench | Start with fixed import providers; defer arbitrary URL import until its network policy is implemented and tested. |
| W-08 | Workbench | Make no regulated/controlled human-data claim in the first release and provide no anonymous public data links. |
| W-09 | Workbench | Members run only administrator-approved, pinned workflow packages; arbitrary user code is out of scope. |
| W-10 | Workbench | Keep installation and user secrets separate and never serialize secrets as workflow parameters or provenance. |
| W-11 | Workbench | Enforce installation capacity plus optional per-member quotas; count deduplicated bytes once physically. |
| W-12 | Workbench | Preserve enough metadata for portable dataset/run export, with RO-Crate compatibility as the target. |

## Foundation decisions

### F-01 — Reserve distinct names for three kinds of “profile”

SeqDesk already has three unrelated concepts:

1. a **deployment profile** (`sequencing-center`, `shared-lab`, or `research-workbench`);
2. a **hosted install profile**, currently selected by the installer's existing `--profile <id>` option;
3. a **Nextflow execution profile**, already represented by fields such as `nextflowProfile`.

Recommendation:

- keep `deployment.profile` as the configuration path and `DeploymentProfileId` as the code type;
- add `--deployment-profile <id>` to the installer rather than reusing `--profile`;
- keep `--profile` as the backwards-compatible hosted install-profile option;
- use `installProfileId` and `nextflowProfile` in code rather than a context-free `profileId`;
- label the choices “Application mode,” “Hosted configuration,” and “Compute profile” in non-technical UI where that is clearer.

Why this matters: reusing `--profile` would silently break the current installer contract, while Nextflow already gives “profile” its own execution-environment meaning.

### F-02 — Define the tenancy boundary

Recommendation: the first release is **single-organization, multi-user**. One installation represents one sequencing center, shared lab, or research team and exposes one deployment profile. Departments and Workbench workspaces are subdivisions inside that installation, not independent tenants.

Consequences:

- no organization switcher or cross-organization membership table is required;
- installation administrators govern shared infrastructure but do not automatically own every private Workbench resource;
- a future hosted multi-tenant service would require a deliberate tenant-key migration and a separate threat model;
- profile switching remains an installation migration, never a per-user view preference.

### F-03 — Decide whether “owner” is a real role

Recommendation: do not introduce a permanent `OWNER` account level. Use peer `ADMIN` accounts with the transactional final-administrator invariant already specified. “First administrator” describes bootstrap order, not a more powerful lifelong role.

Sequencing Center workflow responsibility remains separate: an `OPERATOR` can operate facility work without automatically receiving system-administration access.

This avoids three nearly identical system roles and makes recovery/transfer rules easier for a solo-maintained application.

### F-04 — Make enrollment policy explicit per profile

Recommended defaults:

| Profile | Default after bootstrap | Optional administrator setting |
| --- | --- | --- |
| Sequencing Center | Researcher self-registration allowed | Invite-only, email-domain restriction, email verification |
| Shared Lab | Invite-only | Self-registration with domain restriction if deliberately enabled |
| Research Workbench | Invite-only | Self-registration if the operator deliberately exposes a public instance |

All profiles still use the same login page. Do not add an authentication-free “single user” shortcut: a machine that begins as localhost-only is often exposed later through a proxy without revisiting its security assumptions.

Invites should be single-use, expiring, strongly random, atomically redeemed,
and revocable. Member invitations may be reusable only if a future explicit
group-enrollment design requires it; the initial implementation uses single-use
invitations. Administrator invitations must be bound to a normalized email
address and may grant administrator access directly so a second administrator
can join without sharing credentials. Invitation grants come from the server,
never from the registration form. Local credentials ship first; external
identity providers are covered by F-09.

### F-05 — Define resource ownership separately from creator provenance

Recommendation:

- Sequencing Center requests retain a requester access relationship while the installation remains the operational data steward.
- Shared Lab scientific records are installation-owned/shared; `createdBy` records provenance and does not restrict ordinary member access.
- Workbench datasets, analyses, and runs are workspace-owned; membership determines access.
- Physical cached bytes have no user-facing access semantics of their own.

Never use deletion of a `User` row as the mechanism for deleting scientific data. The current Workbench owner relation uses cascading deletion and must be changed before Workbench becomes a supported profile.

### F-06 — Standardize unavailable versus forbidden responses

Recommendation:

- return `404 Not Found` when a route/domain does not exist in the active deployment profile;
- return `403 Forbidden` when the domain exists but the authenticated principal lacks the action or resource scope;
- return `401 Unauthorized` only when authentication is absent or invalid.

Use the same rule in page layouts, APIs, background-job entry points, and tests. Responses must not reveal secret configuration values or filesystem paths.

### F-07 — Define configuration precedence and mutability

Recommendation for the first release:

- keep the existing runtime precedence `environment > local config file > database > application defaults`;
- resolve profile defaults before local administrator overrides, then validate the final combination against profile constraints;
- persist the deployment profile in local canonical configuration and require restart;
- do not mirror or edit the deployment profile through `SiteSettings` initially;
- let hosted install profiles provide the initial deployment profile and mark genuinely managed values as locked/read-only;
- distinguish a **default** from a **constraint**: a default may be overridden, while a constraint cannot;
- report each resolved setting's source so administrators can understand why a UI value is read-only.

This keeps deployment identity under the control of the installation operator and prevents a database-only change from making web and worker processes disagree.

### F-08 — Reserve a principal type for automation

Recommendation: the authorization layer should distinguish `human` and `service` principals even if personal/service API-token UI is deferred. Automated instruments, CLI clients, repository integrations, and scheduled jobs should eventually use scoped, revocable service credentials with an owning administrator, expiry, last-used time, and audit trail.

Do not reuse a human administrator's password/session or a global bootstrap/admin secret for routine automation. “Run as another user” should not be part of the first release.

### F-09 — Keep login providers replaceable without implementing them now

Recommendation: ship local email/password accounts for the first profile release, but make capabilities and resource membership depend on the internal principal, not on the credential provider. Defer OIDC/LDAP until there is a concrete deployment that needs them.

Schema/API work should avoid assuming every future user has a local password, but the profile project should not expand into a full authentication-provider rewrite.

### F-10 — Separate administration from facility responsibility

Recommendation: persist `MEMBER`/`ADMIN` installation access independently from
Sequencing Center `REQUESTER`/`OPERATOR` responsibility. A center may therefore
have a member/operator who runs the facility without changing global settings,
or an administrator/requester who manages the installation without operating
the facility. Shared Lab and Workbench ignore facility responsibility.

Invitation records store both grants explicitly. The old `User.role` value is
not authoritative; while downgrade support is required, mirror only the system
role (`ADMIN` to `FACILITY_ADMIN`, `MEMBER` to `RESEARCHER`). Mirroring an
operator into the legacy admin value would turn a member/operator into an
administrator after rollback. A future release may remove the legacy field only
after the documented rollback window closes.

## Installation and setup decisions

The detailed operator journey, question copy, readiness split, failure behavior, and acceptance matrix are defined in `docs/architecture/deployment-profiles-installation-setup.md`.

### I-01 — Require an explained choice on fresh guided installs

Recommendation: do not preselect a deployment profile in a fresh interactive wizard. Show three short workflow-based descriptions and require a choice. Existing installations keep their resolved profile without being asked again. During a compatibility window, fresh unattended installs without a value may default to Sequencing Center with a warning; new hosted configurations should specify it explicitly.

### I-02 — Normalize every entry point into one InstallPlan

Recommendation: interactive answers, CLI/JSON input, hosted install profiles, and existing configuration all resolve into the same versioned and validated `InstallPlan`. The review screen and application engine consume that plan rather than implementing their own merging/default logic.

This is the installation equivalent of keeping one application artifact: one validation/application path prevents a solo developer from maintaining several subtly different installers.

### I-03 — Ask about audience before network details

Recommendation: lead with “Only on this computer” versus “On a team server.” Derive safe URL/bind/service defaults, while keeping browser URL, bind address, and local health URL distinct. Loopback is the default; a non-loopback listener requires explicit acknowledgement, and a network deployment is not called production-ready without HTTPS/proxy, firewall/VPN, backup, and monitoring responsibilities being stated.

### I-04 — Bootstrap one real administrator securely

Recommendation: a normal guided install creates exactly one administrator, using an operator-entered or generated strong password. Do not create a generic researcher/member account and never use known packaged credentials. Generated passwords are shown once, after successful account creation, outside logs/saved plans; the local reset command is always provided.

### I-05 — Separate public setup health from authenticated onboarding

Recommendation: the anonymous `/setup` surface reports only non-secret base readiness and performs no mutations. Move seeding/account creation out of the unauthenticated status `GET`. After the administrator signs in, use a reopenable profile-aware onboarding checklist for storage, runtime, invitations, instruments/importers, optional modules, and a first test journey.

### I-06 — Distinguish installed from operationally ready

Recommendation: verify application/database/profile/admin readiness automatically, then report profile-specific operational gaps separately. For example, a Workbench can be installed and allow administrator login while still reporting that managed storage or its pipeline runtime must be completed before analyses can run. Do not print generic success when an expected service fails its health check.

Current branch implementation: public setup status remains base-readiness only.
After administrator login, every profile automatically verifies current managed
storage with a service-identity write lifecycle probe, and Research Workbench
also verifies its configured workflow prerequisites and writable run directory.
This does not yet replace installer post-apply verification, expected-mount or
minimum-capacity policy, or a real workflow smoke run.

### I-07 — Give existing installations a different journey

Recommendation: detect Update, Reconfigure, Diagnose/Resume, and Fresh Install before asking questions. Update preserves profile/configuration and never reopens onboarding. Reconfigure loads existing values, respects hosted locks, shows a diff, and never seeds generic accounts. Deployment-profile changes remain a separate future migration with backup/preflight.

### I-08 — Provide a no-write plan preview

Recommendation: add `--plan` (plus redacted JSON output) to resolve sources/defaults/locks, validate compatibility and paths, show expected downloads/resources, and exit before filesystem, database, or service changes. “Save sanitized plan” in the guided wizard uses the same representation and excludes secret values.

### I-09 — Separate required readiness from recommendations

Recommendation: the authenticated checklist labels every item. Required items
gate ordinary members only when the chosen operating model cannot perform its
normal work without them: managed storage for all profiles and workflow-runtime
readiness for Research Workbench. Backup/retention documentation, enrollment
review, optional integrations, and first test journeys remain recommended.
Replace manual confirmations with automatic storage/runtime verifiers where
feasible, and never present an acknowledgement as an independent verification.

Current branch implementation: both required item types are automatic and
cannot be manually toggled. Successful evidence is versioned and tied to a
non-secret configuration fingerprint, so a relevant configured path or runtime
setting change makes the item incomplete until an administrator reruns the
checks. The point-in-time evidence is not a replacement for continuous health
monitoring. Human confirmations remain recommended and non-blocking.

### I-10 — Make backup and rollback compatibility release gates

Recommendation: define one coherent backup set covering PostgreSQL, canonical
configuration, secrets, installed pipeline metadata, and managed data roots.
Before a schema-changing update, verify or explicitly acknowledge a restorable
backup. Code rollback must check database-schema compatibility and refuse when
the prior release cannot safely read the migrated schema. Recovery documentation
and tests must follow the versioned release layout used by the real installer.

### I-11 — Make installer inputs and downloads an explicit trust boundary

Recommendation: reject unknown configuration fields; show every default and
source in the normalized plan; keep secrets in protected files, environment
injection, or secret references rather than serialized plans or command-line
arguments; and warn or fail when local secret-bearing files have unsafe
permissions. Remote configuration and release/tool downloads use HTTPS except
for explicit localhost development, revalidate redirects, and require hashes.
Pin Miniconda, Nextflow, nf-core, and other executable toolchain versions to a
reviewed compatibility set instead of mutable `latest` endpoints or broad
ranges. The source/CI and packaged installer entry points must consume this same
contract before all three profiles are called supported.

## Shared Lab decisions

### S-01 — Prevent silent overwrites during shared work

Shared Lab deliberately allows several members to edit the same operational records. Recommendation: add a revision or `updatedAt` precondition to meaningful shared edits. Reject stale writes with `409 Conflict`, show who/what changed where practical, and let the user reload or deliberately reapply the change.

Use transactions for multi-record state changes such as sample assignment, run membership, role changes, and final-administrator checks. A live collaborative editor is not required.

### S-02 — Keep lifecycle policy installation-owned

The agreed archive/purge model should be applied uniformly:

- deactivation revokes access but retains shared records;
- archive/trash is reversible and may be available to members for their normal work;
- permanent purge of shared raw data or results is administrator-only, audited, and blocked while referenced by an active run or retention rule;
- retention and quota policy belongs to the installation, not to whichever member created the record.

The remaining product choice is the default retention duration, which should be configuration rather than a hard-coded product constant.

## Research Workbench decisions

### W-01 — Separate workspace multiplicity from collaboration

There are two independent questions:

1. may a researcher create several workspaces/projects? **Yes in the first release**;
2. may several researchers collaborate in one workspace? **Defer unless required for launch**.

The current `WorkbenchWorkspace.ownerId @unique` permits only one workspace per user. Remove that restriction and enforce at most one default workspace per user. This matches the useful Galaxy pattern of multiple histories without requiring the full sharing model immediately.

When collaboration is added, use explicit workspace membership such as `OWNER`/`EDITOR`/`VIEWER` at the resource level. Those are workspace relationship roles, not system-administrator roles. No anonymous share links or public publishing are needed in the first release.

### W-02 — Split logical datasets from physical cached content

The current global `WorkbenchDataset.cacheKey @unique` plus workspace link table combines two different things: user-visible dataset identity and reusable stored bytes.

Recommendation:

- a logical `Dataset` is owned by one workspace and contains name, annotations, kind, validation state, and provenance;
- immutable `DataAsset` records describe the files/URIs used by that dataset;
- an internal `StorageObject` may be content-addressed and reference-counted so identical bytes are stored once;
- linking or deduplicating a storage object never grants access to another workspace's dataset metadata;
- deleting one logical dataset removes physical bytes only when no dataset/run/retention record references them.

This permits safe deduplication, independent names/metadata, and clear quota accounting.

### W-03 — Model collections, not only loose files

A sequencing input is often a structured set rather than one file. Recommendation: the canonical manifest represents:

- samples and stable sample identifiers;
- one or more assets per sample;
- logical roles such as `reads_r1`, `reads_r2`, `assembly`, `annotation`, `reference`, `samplesheet`, or `report`;
- single-end/paired-end relationships, lanes, technical replicates, and nested collections;
- media/datatype, size, checksum, source accession/URI, and validation state.

Filename recognition may suggest this structure, but the confirmed structure must be stored explicitly and validated against a pipeline's semantic input contract.

### W-04 — Choose copy versus link semantics up front

Recommended defaults:

- browser uploads and public-repository imports are copied into SeqDesk-managed storage;
- a configured server-path import offers **copy** by default;
- an administrator may enable a clearly labelled **read-only link** beneath approved roots;
- linked inputs are revalidated at run start and record identity/size/mtime/checksum; a changed or missing input fails rather than silently running different data;
- pipeline outputs are always registered as managed assets;
- exports produce copies and never expose internal absolute paths.

“Move” should not be an import option in the first release because ownership and rollback are ambiguous.

### W-05 — Make dataset/run immutability and provenance a contract

Recommendation:

- stored bytes are immutable after validation;
- display name, tags, and description may be edited with a metadata revision;
- replacing bytes or transforming data creates a new dataset/version with a derivation link;
- every run snapshots input asset IDs/checksums, pipeline package/revision/digest, parameters, effective execution configuration, tool/container information available from Nextflow, initiating principal, and timestamps;
- retry/resume creates an attempt linked to the same logical run, with its own status and execution identifiers;
- result datasets link to the exact run/attempt and source inputs.

Nextflow's experimental lineage support may enrich this later, but SeqDesk should own a stable provenance model rather than depend on an experimental runtime feature.

### W-06 — Define upload sessions as a first-class resource

Large FASTQ uploads cannot rely on one browser request. Recommendation: create an upload session that reserves quota and target storage, accepts resumable chunks, records progress, verifies the final size/checksum/type, and only then materializes a dataset. Expired/abandoned sessions must release reservations and delete partial files.

The concrete protocol/library can be chosen during implementation, but the API/data model must support resume, idempotent completion, cancellation, and reverse-proxy size/time limits. Archive extraction requires entry-count, expanded-size, traversal, and compression-ratio limits.

### W-07 — Start with fixed import providers and an egress policy

Recommended launch order:

1. browser upload;
2. ENA/SRA accession import with metadata preview;
3. generalized NCBI datasets import;
4. approved server-path copy/link;
5. arbitrary HTTP(S) URL only after the SSRF/egress controls are complete.

Each provider should declare its allowed hosts/protocols, credential owner, maximum transfer/expansion size, retry rules, and offline behavior. Preserve repository metadata separately from file bytes: for example, NCBI notes that an SRA run file itself does not contain the associated sample metadata, while ENA record responses provide submitter metadata and cross-links.

### W-08 — State the sensitive-data boundary

Recommendation for the first release:

- authenticate every user and provide no anonymous/public dataset links;
- do not advertise compliance for clinical, controlled-access, or otherwise regulated human genomic data;
- support ordinary research data under the operator's infrastructure policy;
- require a separate threat model and documented controls before adding controlled-repository credentials or making a regulatory claim.

That later review must cover encryption and key ownership, backups, audit retention, breach/incident processes, data locality, export, support access, identity assurance/MFA, and secure erasure. This is a product-support boundary, not a claim that genomic files are harmless.

### W-09 — Fix the workflow trust boundary

Recommendation: all executable workflow packages are administrator-approved and pinned to an immutable version/revision and checksum. Members may create analysis canvases and choose allowed parameters, but may not upload arbitrary scripts, install packages, inject Nextflow configuration, select arbitrary containers, or pass unrestricted cluster options.

For the first release, Nextflow tasks may run under the SeqDesk service operating-system account; therefore application workspaces are not an operating-system sandbox. Strong isolation for mutually untrusted code would require a separate executor/container security project.

### W-10 — Keep secrets out of parameters and provenance

Recommendation:

- installation-owned secrets configure shared infrastructure/providers;
- user-owned secrets authorize that user's external data source and do not become administrator-readable through normal APIs;
- pass secrets through a dedicated runtime secret channel and redact logs/errors;
- store a secret reference and owner in run/import provenance, never the value;
- do not map secrets to ordinary pipeline parameters.

Nextflow explicitly warns that secrets assigned as pipeline parameters can leak; its secrets mechanism keeps them separate and injects them only at execution.

### W-11 — Define quota accounting around physical storage

Recommendation:

- enforce a hard installation capacity/free-space floor for every import and run;
- optionally configure per-member/workspace logical quotas;
- reserve expected bytes before upload/download and reconcile after validation;
- count a deduplicated storage object once against physical installation use;
- do not double-count another logical reference, but display which workspaces prevent reclamation;
- include active uploads, work directories, outputs, caches, trash, and retention holds in capacity reporting;
- keep compute concurrency and wall-time limits separate from storage quotas.

The first UI can expose installation totals plus simple per-member limits; complex cost allocation is deferred.

### W-12 — Preserve an export/portability path

Recommendation: design manifests so a workspace dataset or completed analysis can later be exported with files, checksums, metadata, inputs, outputs, workflow identity, parameters, and provenance. Target RO-Crate/Workflow Run RO-Crate compatibility without requiring a full standards implementation in the first Workbench milestone.

Exports should be asynchronous, quota-aware snapshots because research bundles can be large. Importing such a bundle can be added later.

## Decisions intentionally deferred

These should not hold up the first two implementation slices:

- OIDC, LDAP/Active Directory, MFA, and external identity-provider selection;
- collaborative Workbench workspace sharing, guest access, and public/published workspaces;
- arbitrary user-authored executable tools or workflows;
- regulated/controlled-access human-data support;
- a hosted multi-tenant SeqDesk service;
- live web-based deployment-profile switching;
- complex chargeback/accounting, storage tiers, or per-project billing;
- automatic export/import of complete RO-Crates.

The schema and authorization boundaries should not make these impossible, but no speculative UI or half-supported security mode should ship now.

## Evidence used for these recommendations

- Galaxy separates raw file sources from managed datasets; importing generally copies files into an object store, and datasets then carry metadata, ownership, and sharing rules: [Galaxy — Connecting Users and Data](https://docs.galaxyproject.org/en/release_26.1/admin/data.html).
- Galaxy supports multiple histories, treats datasets as immutable after creation, reuses stored bytes, and records tool/version/input/parameter history: [Galaxy introduction](https://training.galaxyproject.org/training-material/topics/introduction/tutorials/introduction/slides-plain.html).
- Galaxy collections explicitly represent lists, paired reads, and nested dataset structure: [Galaxy — Datasets versus collections](https://training.galaxyproject.org/training-material/faqs/galaxy/histories_datasets_vs_collections.html).
- Galaxy makes registration, purge, quotas, OIDC/local login, and administrative impersonation separate administrator-controlled choices rather than one role switch: [Galaxy configuration](https://docs.galaxyproject.org/en/latest/admin/config.html) and [users/roles/groups/quotas training](https://training.galaxyproject.org/training-material/topics/admin/tutorials/users-groups-quotas/slides-plain.html).
- Galaxy reserves executable tool installation for administrators: [Galaxy introduction](https://training.galaxyproject.org/training-material/topics/introduction/tutorials/introduction/slides-plain.html).
- Nextflow uses “configuration profile” for an execution environment and has explicit configuration precedence, reinforcing the need for distinct SeqDesk terminology: [Nextflow configuration](https://www.nextflow.io/docs/latest/config.html).
- Nextflow secrets are separate from pipeline code/configuration and should not be assigned to pipeline parameters: [Nextflow secrets](https://www.nextflow.io/docs/latest/secrets.html).
- OWASP recommends authenticated/authorized uploads, generated safe filenames, type and size validation, storage outside the web root, and protection against abusive files: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
- User-controlled URL fetches require explicit SSRF protections, including scheme/host/network handling and redirect validation: [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
- ENA record APIs expose submitter metadata and cross-links, while NCBI documents that SRA run files do not themselves contain linked sample metadata: [ENA Browser API](https://ena-docs.readthedocs.io/en/latest/retrieval/programmatic-access/browser-api.html) and [NCBI SRA download guide](https://www.ncbi.nlm.nih.gov/sra/docs/sradownload/).
- RO-Crate is designed to bundle research files/URIs with contextual and provenance metadata, making it a useful export target without dictating SeqDesk's internal schema: [RO-Crate specification](https://www.researchobject.org/ro-crate/specification/1.3/introduction.html).

## Confirmation checklist

Before implementation begins, explicitly confirm or amend the recommended defaults for:

- [ ] F-02 single-organization installation boundary
- [ ] F-03 no permanent `OWNER` system role
- [ ] F-04 invite/self-registration defaults
- [ ] F-07 local/restart-required deployment-profile configuration
- [ ] F-08 service-principal extension point
- [ ] I-01 explicit deployment-profile choice in fresh guided installs
- [ ] I-04 one secure bootstrap administrator and no packaged default accounts
- [ ] I-05 read-only public setup status plus authenticated onboarding
- [ ] I-08 redacted, zero-mutation install-plan preview
- [ ] I-11 strict installer inputs, protected secrets, and pinned/checksummed downloads
- [ ] W-01 multiple private workspaces, collaboration deferred
- [ ] W-04 managed-copy default for imports
- [ ] W-07 provider launch order and arbitrary-URL deferral
- [ ] W-08 sensitive-data support boundary
- [ ] W-09 approved-workflow-only trust boundary

F-01 is a compatibility correction rather than an open product preference: the installer's existing `--profile` flag cannot safely be repurposed.
