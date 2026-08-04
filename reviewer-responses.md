# Reviewer 1

*Thank you for the careful and constructive review. Since the version you evaluated, we have rebuilt the software from the ground up: the original Django code has been reimplemented in Node.js/TypeScript and renamed **SeqDesk**. The scientific purpose is unchanged, but installability, testing, and pipeline integration have been rebuilt. The public repository, demo, documentation, releases, and CI expose the evidence described below; private and credential-gated checks are identified explicitly rather than presented as public evidence.*

**General assessment**

> However, the code base, which this application note is about, is not in a state to be deployed and is debatably non-functional.

Thank you for raising this. It was the concern that mattered most, and addressing it drove much of the work since submission. We have indeed put significant effort into making the installation smooth and the application stable, and you can try the current version right now, with no installation, at **https://demo.seqdesk.org**.

Much of that effort went into automated testing. Pull requests and `main` pushes run the unit/integration and coverage suite, browser tests, and the required clean-install matrix. The public order- and study-pipeline end-to-end workflows run on `main` pushes and manual dispatches, rather than being presented as pull-request checks. Commits to `main` are also mirrored to a private self-hosted acceptance workflow that drives the required lightweight pipeline matrix through a real Slurm allocation and a freshly installed application. For each new `main` push, the public mirror check waits for that commit's private result, so a private failure cannot be hidden behind a green public mirror check for the same push. The public steps are shown on the repository (**https://github.com/hzi-bifo/SeqDesk**). A Slurm claim is made only when the matching private run is green; optional or disabled pipelines are reported as skipped rather than successful, and credential-dependent ENA tests are reported separately.

We also reimplemented most of the application in Node.js/TypeScript with a React interface. Beyond maintainability, this makes it much easier to be confident, and to demonstrate, that the application actually runs: TypeScript surfaces mismatched data and broken interfaces at build time rather than as runtime errors, and that typed structure pairs naturally with the automated tests above. The point-by-point fixes follow below.

**Q1**

> As there are no releases (which in itself is an issue) on the GitHub page. This is based on the latest GitHub commit (d1eb57e).

Thanks for pointing this out. SeqDesk now has proper versioned releases: each one is tagged automatically on GitHub with downloadable build artefacts and checksums, the current release is **v1.1.128** (published 4 August 2026; the full release history is at **https://github.com/hzi-bifo/SeqDesk/releases**), and a plain-language changelog is at **https://seqdesk.org/changelog**. Versions are therefore now unambiguous.

The broader reason for the change is that sequencing facilities differ a lot in their workflows, metadata requirements, and integrations, and the original codebase made supporting that range increasingly difficult. We therefore rewrote the system in Node.js with TypeScript, for modularity and long-term maintenance. TypeScript adds static typing to the build, so mismatched interfaces and incorrect data structures are caught at build time rather than at runtime, a layer that complements the tests described below. The rewrite keeps the same scientific purpose; it also prompted the rename from Broker4Microbiota to SeqDesk, since the tool now serves sequencing facilities generally rather than microbiota-specific use cases.

**Q2**

> Registering projects and samples is easy and intuitive. Along with submitting the project to ENA (I was not able to submit read data/samples to ENA), but if it is similarly easy, this is great and worthy of this publication.

Thank you for the kind words on registration. ENA submission is just as straightforward once credentials are set. It needs the facility's own ENA Webin credentials, entered under **Admin → Data Upload → ENA** (with a *Test Connection* check before they are saved); a public instance with none configured cannot submit, which is the most likely reason it did not complete for you. We have also added clear validation, so that instead of failing silently, the app now names the missing field, for example a taxonomy ID is required on each sample, and a title and description on the study. A built-in test mode submits to ENA's development server (`wwwdev.ebi.ac.uk`) for safe dry runs. A credential-gated end-to-end workflow exercises that external submission path on scheduled or manual runs; it is reported separately from the always-on repository tests. Both standard Webin and broker accounts are supported, and stored credentials are encrypted at rest. The full workflow is documented at **https://seqdesk.org/docs/ena-submission/submitting**.

**Q3**

> There is no documentation, and the README local install instructions do not work, as django-environ is not included in requirements.txt. In settings.py, the .env file path needs to be declared in to environ.Env.read_env() to prevent undefined env vars.

Thank you for flagging this so precisely. Both problems no longer apply, because the Django dependency-and-settings layer that caused them no longer exists. Configuration is now a single JSON file, `settings.json`. It holds both the application settings and the runtime connection details (database URL, authentication secret, and so on) that previously had to be supplied as separate environment variables, so a working install no longer needs a `.env` file at all; environment variables are still read, but only as optional overrides. Application dependencies are locked in `package-lock.json` and installed with `npm ci`. The optional pipeline toolchain is handled separately: packaged workflows pin the pipeline/tool versions they declare, while the shared Conda/Nextflow environment is resolved when it is installed and its observed versions are recorded by the compatibility jobs rather than described as one globally locked environment. The installer checks its prerequisites up front and stops on any problem with a specific, fixable message rather than failing silently. Every setting the file accepts is documented at **https://seqdesk.org/docs/configuration**, and the installation guide at **https://seqdesk.org/docs/installation**; both sit within a full documentation site (**https://seqdesk.org/docs**), and a rewritten README and contributor guide accompany them. Most importantly, the install instructions are now continuously tested: the required matrix installs candidate software from scratch against fresh databases on Ubuntu at the minimum and recommended boundaries and on macOS ARM64, applies migrations, boots it, and authenticates role-gated users. A broader scheduled/manual matrix covers additional Linux distributions and architectures, and each environment is claimed only when its own job is green.

**Q4**

> There are NO TESTS AT ALL for the code base. The core functions that power critical steps are untested, for example, the generation of sample sheets for a pipeline run, or the tests to ensure that the models that encode the MIxS standards enforce them correctly.

Thank you for raising this, and for naming two specific functions. The codebase now carries **more than 4,800 automated tests**, run on pull requests and `main` pushes, with explicit coverage floors enforced in CI (including 82% for lines); the current full local run is about 85% lines, and coverage is reported publicly on Codecov (**https://codecov.io/gh/hzi-bifo/SeqDesk**). Both functions you named are covered:

- **Sample-sheet generation** has a dedicated suite: paired versus single-end selection, raw and cleaned read handling, the configured output format, and required-column enforcement, so that generation fails when a required value (for example an unmapped sequencing platform) cannot be produced, and invalid samples are skipped.
- **MIxS enforcement** is covered too: the standard is encoded as checklist definitions, and tests confirm that the correct checklist is resolved and that its required fields are surfaced and enforced in the generated forms.

Data integrity is also enforced at the point of entry, not only checked afterwards: forms are built from typed field definitions that reject empty required fields, out-of-range or malformed values, invalid checklist selections, and duplicate sample identifiers. This is tested both as unit tests of the field validators and in the browser (for example, a field an administrator marks required is then enforced for the researcher, and duplicate sample identifiers are rejected).

Keeping pace with the MIxS standard is handled by versioned configuration. Each shipped checklist records its ENA accession and source URL, and an administrator can pull the latest registry set from within the app, previewing the added, removed, and changed fields before anything is applied. Updates are non-destructive and version-pinned: before an update, SeqDesk stores the complete outgoing registry definition without count-based pruning; each study records the registry version it was created against and continues to resolve that exact snapshot, while checklists withdrawn upstream are retained as deprecated definitions. A facility can point at its own checklist source instead of ours, and because the full baseline set ships with every install, the platform also works with no registry connection.

**Q5**

> The running of pipelines is dubious. I was not able to get a MAG pipeline to run correctly, even after a couple of hours of genuine effort, both on Slurm, Nextflow, and even local execution. There is a test data mode which just copies files around, but even this was not working with the hook. Despite not being able to run the pipelines, they appear to use Slurm, to use Conda, to use NextFlow, to use Apptainer, leading to very complex debugging!

Thank you, and this is fair. Running pipelines was genuinely too difficult, and we have since standardised it. Every pipeline is now described by a single manifest (its inputs, the sample sheet it expects, its configuration, its outputs, and what it may write back to the database; the manifest format and a worked example are documented at **https://seqdesk.org/docs/pipelines/adding-pipelines**), and one generic, manifest-driven executor runs it **either locally or on a Slurm cluster, in both cases via Nextflow**. Results are written back under a clear policy: metadata automatically, while changes that would replace existing data are staged for administrator review. It is documented here:

- Running pipelines and the run lifecycle: https://seqdesk.org/docs/pipelines/running-pipelines
- The manifest a pipeline package provides: https://seqdesk.org/docs/pipelines/adding-pipelines
- The curated, ready-to-run pipelines: https://seqdesk.org/docs/pipelines/available-pipelines

The ready-to-run set includes the nf-core/mag workflow you attempted, FastQC, a read-cleaning pipeline, and the lightweight "simulate reads" test-data pipeline you mentioned; any group can add its own Nextflow pipeline using the same manifest. The design is also layered: the core application (orders, samples, studies, metadata, and ENA registration) installs and runs on its own. Running the pipelines additionally needs a workflow runtime (Nextflow, with Conda or containers providing each pipeline's tools); a scheduler such as Slurm is supported for cluster-scale execution but is not required, since pipelines also run locally. The installer can provision these components, and each pipeline lists its own requirements. Public order/study end-to-end workflows run on `main` pushes and manual dispatches, using deterministic synthetic reads and a reduced nf-core/mag wiring smoke. The scheduled/manual reviewer matrix separately installs a packaged candidate and executes its lightweight checksum workflow. A private workflow runs the required lightweight matrix through a real Slurm cluster for each mirrored `main` commit and propagates that result back to the public mirror check. Full MAG, MetaxPath, database-dependent read-cleaning, and credential-dependent ENA paths remain explicitly extended or opt-in tests; the documentation lists their exact data and limitations rather than treating them as part of every green change.

**Q6**

> The help texts in the models are truncated to 10 chars (`help_text="Total numb"`), meaning that users are left confused by each required field, defeating the "reducing effort" ethos.

Thank you for catching this. It was a defect in the old Django model definitions and no longer applies. Field help is no longer a fixed model attribute: every form field now shows a full, untruncated description inline, editable by administrators in the form builder, and required fields are marked and validated with their specific label (for example, "Order Name is required").

**Q7**

> The download file button breaks the website.

Thank you for reporting this. We have reimplemented file download and could not reproduce a broken page. Files are now served through dedicated, access-controlled download and preview endpoints that are covered by automated tests. If you can share the exact action, we are glad to investigate, but the failure is not present in the current implementation.

**Q8**

> I am not familiar with Docker Compose, so I could not test that further than `docker compose up` did not work.

Thank you for trying this. Docker Compose has been removed: it belonged to the old version, and we dropped it deliberately. Many sequencing facilities run on managed or HPC infrastructure where Docker is unavailable or not permitted, and the orchestration layer added failure modes (like the one you hit) and made troubleshooting harder. SeqDesk now installs natively through the downloaded one-line installer, the npm launcher, or from source, needing only Node.js and PostgreSQL. The required clean-install matrix covers Ubuntu and macOS, while additional Linux distributions are scheduled/manual compatibility jobs and are claimed only when green. The current README and installation documentation therefore make no Docker installation claim; the Docker description in the reviewed article does not describe the current software.

**Q9**

> I was not able to submit read data / samples to ENA. This might require a pipeline to run, but I do not see why it should.

Thank you, and you are right that data submission runs as a pipeline; the split is deliberate. Registering a study and its samples (the metadata) is a direct, interactive step and uses no pipeline. Submitting the sequence data itself (reads, assemblies, and bins) runs as a pipeline because it is a batch operation: it packages the files, computes and attaches checksums, generates the ENA manifests, and transfers potentially large files, none of which suits a synchronous web request. Both still require the facility's Webin credentials. The external round-trip is exercised by a credential-gated workflow against ENA's test server on scheduled or manual runs and is not conflated with the tests that run on every change. This is documented at **https://seqdesk.org/docs/ena-submission/submitting**.

*In short, these comments directly shaped the changes since submission: versioned releases and a public changelog, full documentation, encrypted ENA credentials, a much larger automated test suite, and a redesigned, continuously tested pipeline system. We hope they address the concerns and make the platform's strengths easier to reach.*

---

# Reviewer 2

*Since the original submission the software has been substantially reimplemented, from Django to Node.js/TypeScript, and renamed SeqDesk; the rationale is in our reply to Reviewer 1 (Q1).*

**Q1**

> 1) The software appears to be very useful and also addresses the metadata deficiency. However, due to the lack of documentation (local installation instruction page is blank), I'm unable to test the software and to evaluate how well the metadata ingestion portion is implemented. GitHub has installation instructions from source, but the manuscript mentioned Docker images as well without further instructions. I would like to see the full installation documentation and example datasets (including metadata) made available for testing before providing my full evaluation.

Thank you, this is a fair request. The example data are now available in two practical forms. For evaluation without installation, **https://demo.seqdesk.org** opens a disposable workspace pre-populated with orders, studies, samples, configurable metadata, read records, and inspectable example pipeline results. For a local evaluation, after choosing the sequencing-data path with `seqdesk storage configure`, a facility administrator can load the deterministic fixture from **Admin → Settings → Demo data** or run `seqdesk demo-data install`. That fixture creates two studies, four orders, samples, metadata, read rows, and deterministic synthetic gzipped FASTQ files; it is idempotent and can be removed without touching unrelated data. The documentation at **https://seqdesk.org/docs** now includes the complete installation section (**https://seqdesk.org/docs/installation**) and an example-data/provenance page (**https://seqdesk.org/docs/getting-started/example-data**) that distinguishes hosted preview records, local synthetic files, and the accessioned public mouse and human reads used by opt-in pipeline tests. Docker is no longer an installation route (native install needs Node.js and PostgreSQL, which we found simpler and more portable than container orchestration), and the current documentation makes that scope explicit. Downloads, external ENA submission, and pipeline execution are disabled only in the shared demo for safety; they are available in a local installation.

---

# Reviewer 3

*Since submission the software has been substantially reimplemented (from Django to Node.js/TypeScript, now named SeqDesk; see Reviewer 1, Q1). Several points concern the framing of the manuscript itself; the responses below give the corrected, repository-backed scope without claiming features that are disabled in the shared demo or tested only in extended workflows.*

**Q1**

> 1) I felt the article itself does not sufficiently emphasise in the first half that the software is specifically for sequencing centers or sequencing core facilities — at points it comes across as a general LIMS system for labs as well.

Thank you, and we agree. SeqDesk is built specifically around the sequencing-facility workflow: researchers submit sequencing orders, the facility manages samples and links sequencing files, optional analysis pipelines run, and studies and samples are brokered to ENA. It is not presented as a general laboratory information management system; this sequencing-facility scope is now explicit in the repository README and the current documentation.

**Q2**

> 2) The article does not sufficiently describe how facilities can customise the interface (e.g. center-specific additional metadata; can you install other pipelines outside of nf-core/mag?).

Thank you, and yes on both counts. Facilities can customise the platform without writing code: a built-in form builder lets administrators add center-specific fields and metadata to the order, sample, and study forms (including MIxS checklists and typed field types) and configure which modules and sequencing technologies are offered. Pipelines are not limited to nf-core/mag either; the platform runs any Nextflow pipeline described by a manifest, the shipped set already includes others (for example a read-cleaning pipeline that wraps nf-core/detaxizer, plus locally bundled workflows), and facilities can add their own. These capabilities and their boundaries are documented at **https://seqdesk.org/docs/administration/form-builders** and **https://seqdesk.org/docs/pipelines/adding-pipelines**.

**Q3**

> 3) The dedicated documentation website appears to be unfinished; there is seemingly little documentation in the GitHub core repository other than basic installation, and the in-interface 'how to' guidance is minimal, making it difficult to understand how to do much.

Thank you. The documentation site has since been substantially expanded, and now covers installation, configuration, orders and studies, sequencing files, pipelines, ENA submission, and administration (**https://seqdesk.org/docs**). The GitHub repository intentionally keeps the step-by-step end-user documentation on that site rather than duplicating it; its README and contributor guide cover building and developing the code itself. The current interface complements those guides with full field descriptions, required-field labels, contextual validation messages, and workflow-specific status guidance rather than attempting to duplicate the complete manual inline.

**Q4**

> 4) I could not actually install the software locally with the current provided setup scripts and documentation.

> I couldn't get the local installation to work, based on the instructions on the GitHub README, even after trying to solve it myself. First time running `setup.sh` it crashed with a missing module error, and I seemingly fixed it by modifying the two `requirements.txt` files (at root, and `projects/`) to include the `django-environ` library. Then I hit another Django-specific error I could not solve quickly. The bare minimum for acceptance is to at least be able to install the software and get it mostly working without too many manual fixes; and without improved documentation (particularly on installation and configuration) I would not be inclined to accept the article.

Thank you for the detailed account; it pinpoints exactly the failure modes of the old Django setup. That entire install path no longer exists: there is no `setup.sh`, no `requirements.txt`, and no Django, so those exact failures (the missing `django-environ`, the follow-on Django errors) cannot recur. SeqDesk now offers a downloaded one-line installer, or the npm launcher (`npm i -g seqdesk` followed by `seqdesk --interactive`). The installer checks prerequisites up front (Node.js `>=22.13.0 <23` or Node.js 24.x, npm, and PostgreSQL 14+) and, on any problem, stops with a specific, fixable message rather than failing silently, then downloads the release, installs dependencies, applies migrations, and seeds data, logging everything. Required candidate installs are verified end to end on Ubuntu and macOS through a successful role-gated login; broader scheduled/manual jobs cover additional Linux environments. Dedicated installation and configuration docs are at **https://seqdesk.org/docs/installation** and **https://seqdesk.org/docs/configuration**. For evaluation with no setup at all, **https://demo.seqdesk.org** needs no installation.

**Q5**

> 5) Overall there seems to be a mismatch between what is reported in the article and what appears to be supported by the demo instance — for example sequencing-center-specific configuration, and file import of Excel sheets (only export seems to exist).

Thank you for raising this, and two clarifications. First, the public demo deliberately hides or disables parts of the administrative configuration, including some sequencing-center-specific setup, because it is a shared instance that resets periodically; those capabilities are present in a normal installation, while the demo is intentionally a restricted preview. Second, Excel import is supported, not only export: samples can be imported into an order from an Excel sheet, with the columns mapped to the configured form fields and validated before the rows are accepted; a matching template can be downloaded to fill in, and this import path is covered by tests at both the parsing and field-mapping level and the browser level. The supported distinction is therefore between the restricted shared demo and the complete default local installation, not between export-only and import-capable editions.
