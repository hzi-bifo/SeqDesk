# SeqDesk

[![codecov](https://codecov.io/gh/hzi-bifo/SeqDesk/branch/main/graph/badge.svg)](https://codecov.io/gh/hzi-bifo/SeqDesk)

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

This will download SeqDesk, install dependencies, and set up the database.

Options:
```bash
# Fully non-interactive install (accept defaults)
curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y

# Custom install directory
SEQDESK_DIR=/opt/seqdesk curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash

# Include Conda for pipeline support
SEQDESK_WITH_CONDA=1 curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash

# Unattended install with infrastructure JSON (same format as admin import JSON)
curl -fsSL https://seqdesk.com/install.sh | \
  bash -s -- -y --config https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/setups/twincore/infrastructure-setup.json
```

## Private Pipeline Add-ons

Public SeqDesk releases intentionally exclude private pipeline packages (for example `metaxpath`).
Install private packages after base installation on the SeqDesk server:

```bash
cd /path/to/seqdesk
METAXPATH_PACKAGE_URL="https://private.example/metaxpath-0.1.0.tar.gz" \
METAXPATH_PACKAGE_TOKEN="..." \
scripts/install-private-metaxpath.sh
```

Optional checksum verification:

```bash
METAXPATH_PACKAGE_URL="https://private.example/metaxpath-0.1.0.tar.gz" \
METAXPATH_PACKAGE_TOKEN="..." \
METAXPATH_PACKAGE_SHA256="<sha256>" \
scripts/install-private-metaxpath.sh
```

## Manual Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### 1. Clone and install

```bash
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk
npm install
```

### 2. Set up environment variables

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Required variables:
```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="your-secret-key"
ANTHROPIC_API_KEY="sk-ant-..."  # Optional: for AI validation features
```

### 3. Set up the database

```bash
# Push the schema to the database
npx prisma db push

# Seed with initial data (users, departments, form config)
npx prisma db seed
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Default Login Credentials

After seeding the database:
- **Admin**: `admin@example.com` / `admin`
- **Researcher**: `user@example.com` / `user`

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
# Copy the example config
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

## Testing

Run the test suite:

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Test files are co-located with source files using the `*.test.ts` convention.
Coverage reports are generated in the `coverage/` directory.

Tests run automatically on every push and pull request via GitHub Actions.

## License

MIT
