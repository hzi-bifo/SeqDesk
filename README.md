# SeqDesk

A modern sequencing facility management system built with Next.js for managing sequencing orders, samples, and data submissions to the European Nucleotide Archive (ENA).

## Features

- **Order Management**: Create and track sequencing orders with customizable workflows
- **Sample Tracking**: Manage samples with MIxS-compliant metadata
- **Study Organization**: Group samples into studies for ENA submission
- **Sequencing File Management**: Auto-discovery and assignment of FASTQ files
- **Pipeline Integration**: Run nf-core pipelines (MAG) with real-time progress tracking
- **ENA Submission**: Submit data to the European Nucleotide Archive
- **Role-based Access**: Separate workflows for researchers and facility admins

## Tech Stack

- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Database**: Prisma ORM with SQLite
- **Authentication**: NextAuth.js
- **UI**: Tailwind CSS + shadcn/ui components
- **Visualization**: React Flow for pipeline DAGs

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash
```

The script will detect your system, check (and optionally install) dependencies, clone SeqDesk, install Node dependencies, configure environment and config file, initialize the database, and optionally set up Conda and pipeline support. It defaults to installing into `./seqdesk` and using port 8000.

**Options** (environment variables; set before the curl command; same as [scripts/install.sh](scripts/install.sh)):

```bash
# Example: custom install directory
SEQDESK_DIR=/opt/seqdesk curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash
```

You can combine any of these variables with the same curl command:

| Variable | Description |
|----------|-------------|
| `SEQDESK_DIR` | Install directory (default: `./seqdesk`) |
| `SEQDESK_BRANCH` | Git branch (default: `main`) |
| `SEQDESK_YES=1` | Non-interactive; accept defaults |
| `SEQDESK_WITH_PIPELINES=1` | Enable pipeline support (Conda + Nextflow). Legacy: `SEQDESK_WITH_CONDA=1` |
| `SEQDESK_PORT` | App port (default: `8000`) |
| `SEQDESK_DATA_PATH` | Sequencing data base path |
| `SEQDESK_RUN_DIR` | Pipeline run directory |
| `SEQDESK_NEXTAUTH_URL` | NextAuth URL |
| `SEQDESK_DATABASE_URL` | Database URL (default: SQLite in project) |
| `SEQDESK_SKIP_DEPS=1` | Skip dependency checks |
| `SEQDESK_LOG` | Write install log to path |

## Manual Installation

Manual steps mirror what [scripts/install.sh](scripts/install.sh) does. Default port is 8000 (script uses 8000; Next.js uses 3000 only if `PORT` is not set).

### Prerequisites

- **Node.js 18+**
- **npm**
- **Git** (for clone)

Optional (for pipeline execution):

- **Conda** (Miniconda or Anaconda)
- **Nextflow**

On some systems the install script can install Node and Git for you (e.g. Homebrew on macOS, NodeSource on Debian/RHEL). See [docs/installation.md](docs/installation.md) for details.

### 1. Clone and install

Clone into a directory (the script uses `./seqdesk` by default):

```bash
git clone --branch main --depth 1 https://github.com/hzi-bifo/SeqDesk.git seqdesk
cd seqdesk
npm install
```

### 2. Configure environment

Copy the example environment file, then set required variables. Generate a secret for `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`):

```bash
cp .env.example .env
```

Edit `.env`. Required:

- `DATABASE_URL` – e.g. `file:./dev.db` for SQLite
- `NEXTAUTH_SECRET` – random string (required by NextAuth)
- `NEXTAUTH_URL` – e.g. `http://localhost:8000` (must match the port you run on)
- `PORT` – e.g. `8000` (optional; Next.js defaults to 3000 if unset)

Optional: `ANTHROPIC_API_KEY` for AI validation features.

### 3. Config file (optional but recommended)

Create or update `seqdesk.config.json` so the app knows data paths and pipeline settings. The install script does this automatically; for manual install:

```bash
cp seqdesk.config.example.json seqdesk.config.json
# Edit seqdesk.config.json (site.dataBasePath, pipelines.execution.runDirectory, etc.)
```

Environment-specific example configs (e.g. for Twincore) can be found in `setups/` (e.g. `setups/twincore/seqdesk.config.example.json`).

See [Configuration](#configuration) and [docs/configuration.md](docs/configuration.md).

### 4. Initialize the database

```bash
npx prisma db push
npx prisma db seed
```

This creates the schema and seeds initial data (users, departments, form config). If `prisma db seed` fails, you can try running `node prisma/seed.mjs` if present.

### 5. Pipeline support (optional)

If you want to run nf-core pipelines (e.g. MAG), install Conda and Nextflow, then use the project script:

```bash
./scripts/setup-conda-env.sh --full --yes
```

This configures Conda, creates the pipeline environment, and updates `seqdesk.config.json`. See [docs/installation.md](docs/installation.md) for Conda setup details.

### 6. Run the development server

```bash
npm run dev
```

Open **http://localhost:8000** (or the port you set in `PORT` / `NEXTAUTH_URL`) in your browser.

### Default login credentials

After seeding:

- **Admin**: `admin@example.com` / `admin`
- **Researcher**: `user@example.com` / `user`

### Next steps

1. Log in as admin and configure **Data Storage** under Admin > Data Storage.
2. If pipelines are enabled, configure **Pipeline Runtime** under Admin > Pipeline Runtime.
3. See [docs/installation.md](docs/installation.md) for production deployment.

## Database Management

### Reset and reseed the database

```bash
# Force reset (clears all data)
npx prisma db push --force-reset

# Reseed with initial data
npx prisma db seed
```

### Update schema

After making changes to `prisma/schema.prisma`:

```bash
npx prisma db push
```

## Project Structure

```
SeqDesk/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── admin/        # Admin pages
│   │   ├── api/          # API routes
│   │   └── dashboard/    # User dashboard pages
│   ├── components/       # React components
│   └── lib/              # Utilities, Prisma client
├── prisma/               # Database schema and seed
├── data/                 # JSON data files
│   └── field-templates/  # MIxS field templates
├── pipelines/            # Pipeline packages (manifest/definition/registry)
├── docs/                 # Documentation
└── scripts/              # Utility scripts
```

## Configuration

SeqDesk can be configured via config file, environment variables, or the Admin UI.

### Quick Setup with Config File

```bash
# Copy the example config (or use an environment-specific one from setups/, e.g. setups/twincore/)
cp seqdesk.config.example.json seqdesk.config.json

# Edit for your environment
vim seqdesk.config.json
```

### Configuration Priority

1. **Environment variables** (`SEQDESK_*`) - Highest priority
2. **Config file** (`seqdesk.config.json`) - Project-level settings
3. **Database** - UI-editable via Admin Settings
4. **Defaults** - Built-in fallbacks

### Key Environment Variables

```bash
# Site
SEQDESK_SITE_NAME="My Facility"
SEQDESK_DATA_PATH="/data/sequencing"

# Pipelines
SEQDESK_PIPELINES_ENABLED=true
SEQDESK_PIPELINE_RUN_DIR="/data/runs"
SEQDESK_CONDA_ENABLED=true
SEQDESK_CONDA_PATH="/opt/conda"

# ENA (never put password in config file!)
SEQDESK_ENA_TEST_MODE=true
SEQDESK_ENA_PASSWORD="your-webin-password"
```

See [docs/configuration.md](docs/configuration.md) for the complete configuration reference.

## Documentation

See the `docs/` folder for detailed documentation:
- [Installation Guide](docs/installation.md) - Complete setup including Conda for pipelines
- [Configuration](docs/configuration.md) - Configuration file and environment variables
- [Adding Pipelines](docs/adding-pipelines.md) - How to add new nf-core pipeline definitions
- [Backend Features](docs/backend-features.md) - Pipeline system architecture
- [ENA Integration](docs/ena-integration-plan.md) - ENA submission workflow
- [Sequencing Files](docs/sequencing-files-plan.md) - File discovery and assignment

## Development

See [CLAUDE.md](CLAUDE.md) for development guidelines and code conventions.

## License

MIT
