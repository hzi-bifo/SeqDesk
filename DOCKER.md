# Docker Compose installation for reviewers

This optional installation builds the checked-out SeqDesk source and runs the
web application with PostgreSQL 16. It is intended for local reviewer evaluation.
The guided [native installation](./docs/installation.md) remains the path for
facility operation and pipeline execution. Prebuilt images are prepared for
publication at `ghcr.io/hzi-bifo/seqdesk`; the first registry publication has not
yet happened. Use the source-build instructions below until a public image and
its Compose download are available.

## Start from source (available now)

Install Docker Engine with the Compose plugin, or Docker Desktop running Linux
containers. On macOS, Docker with Colima is also supported by the local test
described below.
Allow approximately 8 GB of memory for the source build and sufficient free disk
space for Node dependencies, images, and data. The first build needs internet
access to download base images and npm dependencies. Run from this repository:

```bash
# Generate unique credentials once; refuses to overwrite an existing file.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" -w /workspace node:24-bookworm-slim \
  node docker/setup.mjs --show-login

docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker \
  up --build --wait --wait-timeout 600
```

Alternatively, with Node.js installed, generate the credentials with
`node docker/setup.mjs --show-login`. Keep `.env.docker`: it is ignored by Git and excluded
from the Docker build. It contains the database password, session secret, and
initial administrator password. Do not regenerate it while keeping the database
volume. Compose exposes credentials to users with access to the Docker daemon;
this is a local review setup, not a production secret-management solution.

## Login

The setup command prints a **SeqDesk Docker login** summary with the URL,
**reviewer@example.org**, and your generated initial password. After Compose
reports that the app is healthy, open **http://localhost:8000** and use that
email and password. Keep `.env.docker` so you can recover the initial password
and restart the same installation. Only this administrator
is created; there is no default researcher login. Complete the initial setup
in the UI. Storage is already set to `/storage` inside the container.

To display the login details again from a source checkout, run:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace:ro" -w /workspace node:24-bookworm-slim \
  node docker/login.mjs --show-password
```

This reads the current port from `.env.docker`. The password is printed only
when explicitly requested by `--show-login` or `--show-password`; automated
smoke tests omit these flags. It is the initial password: changing the password
in the UI or editing `.env.docker` does not make that stored value authoritative
for an existing account.

The port binds only to host loopback; PostgreSQL has no published host port.
If port 8000 is occupied, add `SEQDESK_DOCKER_PORT=8001` to `.env.docker` and
use http://localhost:8001 instead. The generated URLs use `localhost`.

## Install a prebuilt image (after the first publication)

**Publication pending.** These commands become usable after a release containing
this Docker setup has passed the image workflow and the GHCR package is public.
Choose an actual published version from the release; replace `X.Y.Z` below.
This path requires Docker and `curl`, and uses a Linux/macOS shell. It downloads
one Compose file and the image; it does not require Git, Node.js on the host,
or an application build.

```bash
mkdir seqdesk-reviewer
cd seqdesk-reviewer
SEQDESK_DOCKER_VERSION=X.Y.Z
curl -fLo compose.yaml \
  "https://github.com/hzi-bifo/SeqDesk/releases/download/v${SEQDESK_DOCKER_VERSION}/compose.yaml"

docker run --rm --entrypoint node --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" \
  "ghcr.io/hzi-bifo/seqdesk:${SEQDESK_DOCKER_VERSION}" \
  docker/setup.mjs /workspace/.env.docker --show-login

docker compose --env-file .env.docker up --wait --wait-timeout 600
```

The release's Compose file pins the application image to that release version.
The setup summary gives you the login described above. To show it again, use
that same image with `docker/login.mjs /workspace/.env.docker --show-password`
and change the mount to `$PWD:/workspace:ro`. Keep the same Compose directory
and credentials to retain your database and files.

## What reviewers can evaluate

| Area | Scope in this Compose setup |
| --- | --- |
| Web application, administrator login, orders API | Covered by the Docker smoke test when it runs successfully |
| Studies, orders, samples, metadata forms, administration | Available for manual review; not exhaustively tested by the Docker smoke test |
| Database and managed files | Separate named volumes; preserved across stop/start and container recreation |
| Example dataset | Optional existing **Admin → Settings → Demo data** feature; creates explicitly synthetic local FASTQ fixtures, not external-service results; not included in the smoke test |
| File access | Container `/storage` only by default; host/NAS paths are not automatically visible. Additional bind mounts require container paths and UID 1000 write permissions |
| Nextflow, Conda, Slurm, pipeline execution | Not supported by this image; disabled by default, no toolchain or worker installed. Do not enable these switches and assume execution is available |
| Explore compute and instrument/stream workers | Not provided or tested; this image runs only the web process |
| ENA/SRA, email, external APIs, private pipeline packages | Not configured or validated by this setup. Real credentials and network access remain necessary; no responses or accessions are simulated. Email notifications are disabled |
| In-app update/rollback and native launcher commands | Not supported: no PM2 or native installer layout. Rebuild and recreate the image instead |
| Production operation | TLS, backups, monitoring, scaling, and remote exposure are not configured or validated |

The image uses Node.js 24 on Debian Bookworm and runs SeqDesk as UID 1000.
The build uses the repository's offline font fallback, so decorative typography
can differ from a build that downloads Google Fonts. Local settings, credentials,
sequencing data and build output are excluded from the build context.

## Stop, resume, rebuild

```bash
# Stops containers, keeps data and uploaded files.
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker down
# Resumes the same installation.
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker up --wait --wait-timeout 600
# After deliberately checking out another revision, rebuild it.
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker \
  up --build --wait --wait-timeout 600
# Diagnose startup problems.
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker logs --tail 100 app db
```

For the prebuilt-image path, omit `-f compose.build.yaml`; its downloaded
Compose file already pins the image. Update by deliberately choosing another
published version and its Compose file, then running `docker compose --env-file .env.docker pull`
before starting it. Back up your data first.

Every app startup applies pending migrations with `migrate deploy`, then runs the
idempotent seed. Existing account passwords are preserved. Changing the bootstrap
password in `.env.docker` does not reset an existing account's password. Back up
both volumes before changing versions; database migrations may prevent a simple
image downgrade. Keep the same directory/project name to reuse the same volumes.
Only managed files under `/storage` and PostgreSQL data are persisted; arbitrary
files added elsewhere in the container are not.

To **permanently delete this review installation's database and managed files**:

```bash
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker down --volumes
```

## Validation and limits of the evidence

Run the real integration smoke test on a Docker-capable machine (Node.js is also
required for the default source-build test):

```bash
bash scripts/ci/test-docker-reviewer.sh
```

It builds the image, waits for PostgreSQL and the app, authenticates the real
administrator through NextAuth, calls the authenticated orders API, verifies
that only one account exists, and writes a storage probe. It then removes and
recreates both containers and checks that the same database account, password
hash, and storage probe survive. It uses a unique Compose project and removes
only that test project's volumes on exit. It does not use your `.env.docker`.

[Docker reviewer CI](.github/workflows/docker-reviewer.yml) runs this test on
Ubuntu 24.04 x64 for pull requests and main pushes and supports manual runs.
This installation-check workflow is separate from the native release gates.
The [image publication workflow](.github/workflows/docker-publish.yml) runs after
**Build Release** succeeds, or can be manually retried for an already published
stable release with successful native gates. It verifies the tag/version/SHA,
builds on native Ubuntu AMD64 and ARM64 runners, tests each candidate using
`compose.yaml` without rebuilding it, and publishes those exact saved images
only after both architecture tests pass. It attaches the version-pinned
`compose.yaml` download to the existing release and moves `latest` only if that
release is still the latest stable release.

The first GHCR package must be made **Public** in GitHub Packages settings before
advertising anonymous pulls. Newly created packages default to private; public
images can be downloaded without a GitHub login. See the
[GitHub Container Registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
The workflow uses its repository `GITHUB_TOKEN`; no personal registry token is
needed. For reproducible deployments, prefer a version or digest over `latest`.
Registry publication and the architecture CI jobs have not run yet.

**Local validation on 6 October 2026:** the complete image build and Compose
smoke test passed on macOS 26.5.2 / Apple Silicon using Colima 0.10.3, Docker
Engine 29.5.2, and Compose 5.6.0. The containers ran Linux/ARM64 with Node.js 24
and PostgreSQL 16. Both the first start and container recreation authenticated
successfully and preserved the database account, password hash, and managed
storage probe. The documented container-based credential setup was also tested.
A separate Chromium check signed in through the web UI and rendered the
sequencing overview without JavaScript or server errors.

**GitHub validation on 6 October 2026:** the full source-build smoke test also
passed on Ubuntu 24.04 / Linux AMD64 ([successful run](https://github.com/hzi-bifo/SeqDesk/actions/runs/37451187220)),
including the real login and persistence checks before and after container recreation.

Docker Desktop, Windows hosts,
all other browser interactions, pipelines, and external service integrations
remain outside this local test's evidence. The Docker-only credential setup and no-build Compose path also passed using
the locally exported and reloaded candidate image. This verifies the image
installation mechanism; an anonymous GHCR download has not been tested yet.
The smoke test is intentionally
limited to the application and persistence checks described above.

Compose startup waits for the database health check, following the
[Docker Compose startup-order guidance](https://docs.docker.com/compose/how-tos/startup-order/).
