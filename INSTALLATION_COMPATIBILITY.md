# Installation compatibility and reproducibility

SeqDesk tests a clean candidate release through the same npm-launcher and
checksum-verified tarball path used by an installer. The source of truth is the
[`Reviewer Installation Matrix`](https://github.com/hzi-bifo/SeqDesk/actions/workflows/reviewer-install-matrix.yml)
workflow. A combination is demonstrated only when its corresponding job is
green; each run records the versions that were actually observed.

## Required checks

Every pull request, merge-queue candidate, push to `main`, release, scheduled
run, and manual run executes both of these clean-install boundaries:

| Operating system | CPU | Node.js | PostgreSQL | Purpose |
|---|---:|---:|---:|---|
| Ubuntu 24.04 | x64 | 24 | 16 | Recommended current LTS environment |
| Ubuntu 22.04 | x64 | 22.13.0 | 14 | Exact minimum supported dependency boundary |

These jobs use a PostgreSQL service prepared by the workflow, pre-create the
test role and database, and pass explicit database URLs to the installer. They
prove that SeqDesk installs, migrates, and runs against those PostgreSQL
versions. They do **not** prove that the installer or a guide can install an OS
package, enable a database service, or satisfy every distribution-specific
authentication policy on a bare host.

A stable aggregate gate fails if the candidate build or either installation is
failed or skipped. The release workflow must pass this gate before it can
publish the exact checksummed archive exercised by the matrix; it does not
rebuild the release after the installation tests pass.

## Extended weekly and manual matrix

The extended matrix is deliberately pairwise rather than a full Cartesian
product. It adds OS, architecture, and dependency boundaries without rebuilding
the candidate for every job.

| Environment | CPU | Node.js | PostgreSQL | Scope |
|---|---:|---:|---:|---|
| Ubuntu 24.04 | ARM64 | 24 | 17 | Application install |
| macOS 15 | ARM64 | 24 | 16 | Application install |
| macOS 15 | Intel x64 | 24 | 16 | Application install |
| Debian 12 container | x64 | current 22 LTS | 18 | Application install |
| Rocky Linux 9 container | x64 | 24 | 15 | Application install |
| Ubuntu 24.04 | x64 | 24 | 16 | Application plus packaged `fastq-checksum` pipeline |

Together with the required checks, this exercises both supported Node LTS lines
(22.13.0+ on 22.x and 24.x) and PostgreSQL majors 14 through 18. Odd-numbered
and future Node majors are not claimed as supported until they are added to this
matrix. Docker-based distro jobs test the distro
userland inside containers on the GitHub-hosted Ubuntu kernel. They are not
bare-metal or VM boot tests, do not exercise `systemd`, and are not claims about
a Debian or Rocky Linux kernel.

## What a passing application job proves

Each job:

1. installs the locally packed candidate npm launcher;
2. fetches the locally built release through a checksum-bearing release
   manifest;
3. installs into a new, non-existing directory;
4. installs locked runtime dependencies and applies migrations to a fresh
   PostgreSQL database;
5. boots the packaged application and checks `/api/auth/providers` and
   `/api/setup/status`;
6. authenticates the seeded facility administrator and researcher; and
7. confirms that the installed version is exactly the candidate version.

The pipeline job additionally lets the installer create its Conda environment,
records Java and Nextflow versions, and executes the packaged
`fastq-checksum` workflow on tiny synthetic reads.

Every job uploads installer/server logs, endpoint responses, a version inventory,
and both Markdown and JSON compatibility reports. Failure reports identify the
stage that failed, so a reviewer can distinguish an OS, database, dependency,
installation, boot, or authentication failure.

## Scope and limitations

- Linux and macOS application installs are tested. Native Windows is not
  supported; a Windows contract test verifies that the launcher stops with WSL
  guidance. This is not a claim that WSL itself was tested.
- Public packaged-pipeline execution evidence is limited to the
  `fastq-checksum` workflow on tiny synthetic reads in the Linux pipeline job.
  It does not validate production datasets or every bundled workflow. The macOS
  jobs intentionally test the application installation only.
- Real SLURM execution is covered by a separate private, self-hosted integration
  test; it is not part of the public compatibility matrix.
- The scheduled
  [`Install Real-Network Smoke`](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-real-network-smoke.yml)
  separately checks the already-published npm package and public installer over
  the real network. It is network-dependent, is not candidate-build evidence,
  and is not a required pull-request or release-gate check.
- The matrix is compatibility evidence, not a performance benchmark, security
  audit, or validation of every storage, scheduler, and institutional network
  configuration.

## Reproducing the evidence

Open the Reviewer Installation Matrix in GitHub Actions, choose **Run workflow**,
and download the `reviewer-*` artifacts after completion. Manual runs execute
the required checks and the full extended matrix. No repository or facility
secrets are required.
