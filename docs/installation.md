# SeqDesk Installation Guide

This guide covers installing SeqDesk on a fresh machine, including setting up Conda for pipeline execution.

## Table of Contents

1. [Install via script](#install-via-script)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Installation](#detailed-installation)
5. [Conda Setup for Pipelines](#conda-setup-for-pipelines)
6. [Configuration](#configuration)
7. [Running in Production](#running-in-production)
8. [Troubleshooting](#troubleshooting)

---

## Install via script

You can install SeqDesk in one command. The script detects your system, checks (and optionally installs) Node and Git, clones the repo, installs dependencies, configures `.env` and `seqdesk.config.json`, initializes the database, and optionally sets up Conda and pipeline support. It installs into `./seqdesk` by default and uses port 8000.

```bash
curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash
```

Set environment variables before the command to customize (e.g. `SEQDESK_DIR=/opt/seqdesk`, `SEQDESK_WITH_PIPELINES=1`, `SEQDESK_YES=1`). See the [README](../README.md#quick-install) or the script header in `scripts/install.sh` for all options.

The sections below describe the same steps manually.

---

## Prerequisites

### Required

- **Node.js 18+** - JavaScript runtime
- **npm** or **yarn** - Package manager
- **Git** - Version control

The install script can install Node and Git for you on macOS (Homebrew), Debian, and RHEL/CentOS. If you use the script, you can omit manual Node/Git install when it offers to install missing dependencies.

### Optional (for pipeline execution)

- **Conda** (Miniconda or Anaconda) - For nf-core pipeline dependencies
- **Nextflow** - Workflow engine

---

## Quick Start

```bash
# Clone the repository (or use a different directory name; the script uses ./seqdesk)
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env: set NEXTAUTH_SECRET (e.g. openssl rand -base64 32), NEXTAUTH_URL, PORT (default 8000)

# Optional: create config file so the app knows data paths and pipeline settings
cp seqdesk.config.example.json seqdesk.config.json
# Or use an environment-specific example from setups/ (e.g. setups/twincore/seqdesk.config.example.json)
# Edit seqdesk.config.json as needed

# Initialize database
npx prisma db push
npx prisma db seed

# Start the server
npm run dev
```

Open http://localhost:8000 (or the port you set in `PORT`) and log in with:
- **Admin**: `admin@example.com` / `admin`
- **Researcher**: `user@example.com` / `user`

---

## Detailed Installation

### 1. Install Node.js

**macOS (using Homebrew):**
```bash
brew install node
```

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**RHEL/CentOS:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

Verify installation:
```bash
node --version  # Should be v18.x or higher
npm --version
```

### 2. Clone and Install SeqDesk

```bash
# Clone the repository (the install script uses ./seqdesk and --depth 1)
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk

# Install Node.js dependencies
npm install
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Required
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="generate-a-random-string-here"
NEXTAUTH_URL="http://localhost:8000"
PORT="8000"

# Optional: AI validation features
ANTHROPIC_API_KEY="sk-ant-..."
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

`NEXTAUTH_URL` and `PORT` must match: if you use port 8000, set `NEXTAUTH_URL="http://localhost:8000"` and `PORT="8000"`. If you omit `PORT`, Next.js defaults to 3000.

### 4. Create or update config file

Create a config file so the app knows data paths and pipeline settings. The install script does this automatically; when installing manually:

```bash
cp seqdesk.config.example.json seqdesk.config.json
```

A suitable example for a specific environment may be in `setups/` (e.g. `setups/twincore/` contains `seqdesk.config.example.json` and `infrastructure-setup.json` for the Twincore environment). Edit `seqdesk.config.json` (e.g. `site.dataBasePath`, `pipelines.execution.runDirectory`). See [Configuration](#configuration) and [configuration.md](configuration.md).

### 5. Initialize Database

```bash
# Create database schema
npx prisma db push

# Seed with initial data (creates admin user, departments, form config)
npx prisma db seed
```

If `npx prisma db seed` fails, try running the seed script directly: `node prisma/seed.mjs` (or `prisma/seed.js` if present). The install script also installs the `bcryptjs` dependency if it is missing for seeding.

### 6. Start the Application

**Development mode:**
```bash
npm run dev
```

Open http://localhost:8000 (or the port in your `PORT` / `NEXTAUTH_URL`).

**Production mode:**
```bash
npm run build
npm start
```

**Next steps after first start:**

1. Log in as admin and configure **Data Storage** under Admin > Data Storage.
2. If you use pipelines, configure **Pipeline Runtime** under Admin > Pipeline Runtime.
3. See [Running in Production](#running-in-production) below for PM2/systemd deployment.

---

## Conda Setup for Pipelines

SeqDesk can run nf-core pipelines (like MAG) using Conda for dependency management.
Pipeline execution is supported on Linux only. For macOS or Windows hosts, use a
Linux/SLURM server to run pipelines.

### 1. Install Miniconda

**macOS/Linux:**
```bash
# Download installer
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
# Or for macOS:
# wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh

# Run installer
bash Miniconda3-latest-*.sh -b -p $HOME/miniconda3

# Initialize conda
$HOME/miniconda3/bin/conda init bash  # or zsh

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

Verify installation:
```bash
conda --version
```

If your server cannot use the `defaults` channel, configure channels like this:
```bash
conda config --remove channels defaults
conda config --add channels conda-forge
conda config --add channels bioconda
conda config --set channel_priority strict
```

### Quick setup (recommended)

SeqDesk includes a helper script that configures Conda, creates the pipeline
environment, writes a config file, and runs sanity tests:

```bash
./scripts/setup-conda-env.sh --full --yes
```

Notes:
- By default the script removes the `defaults` channel (use `--keep-defaults` to skip).
- It enforces channel order `conda-forge`, `bioconda` and sets strict priority.
- Environment name defaults to `seqdesk-pipelines` (override with `--env`).
- Config is written to `seqdesk.config.json` (override with `--config-path`).
- Data directories default to `./data` and `./pipeline_runs` in the current working directory
  (override with `--data-path` and `--run-dir`).
- Pipeline tests run by default on Linux and output to `./pipeline_test_out`
  (override with `--test-outdir`). Use `--no-test-pipeline` to skip.

If conda is not on PATH, pass the base path:
```bash
./scripts/setup-conda-env.sh --full --yes --conda-path "$(conda info --base)"
```

If you only want to set up the Conda environment:
```bash
./scripts/setup-conda-env.sh --yes
```

### 2. Install Nextflow (manual)

```bash
# Install Java (required by Nextflow)
conda install -c conda-forge openjdk=17

# Install Nextflow
curl -s https://get.nextflow.io | bash
sudo mv nextflow /usr/local/bin/

# Verify
nextflow -version
```

Or install via Conda:
```bash
conda install -c bioconda nextflow
```

### 3. Create SeqDesk Environment (Optional)

You can create a dedicated Conda environment:

```bash
# Create environment
conda create -n seqdesk-pipelines python=3.11 openjdk=17 nextflow nf-core -c conda-forge -c bioconda

# Activate
conda activate seqdesk-pipelines
```

### 4. Configure SeqDesk for Conda

Create a config file:

```bash
cp seqdesk.config.example.json seqdesk.config.json
```

Edit `seqdesk.config.json`:

```json
{
  "site": {
    "name": "My Sequencing Facility",
    "dataBasePath": "/data/sequencing"
  },
  "pipelines": {
    "enabled": true,
    "execution": {
      "mode": "local",
      "runDirectory": "/data/pipeline_runs",
      "conda": {
        "enabled": true,
        "path": "/home/user/miniconda3",
        "environment": "seqdesk-pipelines"
      }
    },
    "mag": {
      "enabled": true,
      "version": "3.4.0"
    }
  }
}
```

Or use environment variables:

```bash
export SEQDESK_PIPELINES_ENABLED=true
export SEQDESK_CONDA_ENABLED=true
export SEQDESK_CONDA_PATH="$HOME/miniconda3"
export SEQDESK_CONDA_ENV="seqdesk-pipelines"
export SEQDESK_PIPELINE_RUN_DIR="/data/pipeline_runs"
```

### 5. Create Data Directories

```bash
# Create directories for sequencing data and pipeline runs
sudo mkdir -p /data/sequencing
sudo mkdir -p /data/pipeline_runs

# Set permissions (adjust user as needed)
sudo chown -R $USER:$USER /data/sequencing
sudo chown -R $USER:$USER /data/pipeline_runs
```

### 6. Test Pipeline Setup

In the SeqDesk Admin UI:
1. Go to **Platform Settings** > **Pipelines**
2. Click **Check Prerequisites**
3. Verify Nextflow and Conda are detected

---

## Configuration

### Configuration File

Create `seqdesk.config.json` in the project root:

```json
{
  "site": {
    "name": "HZI Sequencing Facility",
    "dataBasePath": "/data/sequencing",
    "contactEmail": "sequencing@example.com"
  },
  "pipelines": {
    "enabled": true,
    "execution": {
      "mode": "local",
      "runDirectory": "/data/pipeline_runs",
      "conda": {
        "enabled": true,
        "path": "/opt/miniconda3"
      }
    },
    "mag": {
      "enabled": true,
      "version": "3.4.0",
      "stubMode": false
    }
  },
  "ena": {
    "testMode": true,
    "centerName": "My Institution"
  },
  "sequencingFiles": {
    "extensions": [".fastq.gz", ".fq.gz"],
    "scanDepth": 2,
    "allowSingleEnd": true
  }
}
```

### Environment Variables

For sensitive data, use environment variables:

```bash
# Add to ~/.bashrc or /etc/environment
export SEQDESK_ENA_PASSWORD="your-webin-password"
export NEXTAUTH_SECRET="your-secret-key"
```

See [docs/configuration.md](configuration.md) for the complete reference.

---

## Running in Production

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Build the application
npm run build

# Start with PM2
pm2 start npm --name "seqdesk" -- start

# Auto-start on boot
pm2 startup
pm2 save
```

Note: The in-app updater can only auto-restart when SeqDesk is managed by PM2 or systemd.
If you use the release tarball, start it with PM2 using `pm2 start ./start.sh --name seqdesk`.

### Using systemd

Create `/etc/systemd/system/seqdesk.service`:

```ini
[Unit]
Description=SeqDesk Sequencing Management
After=network.target

[Service]
Type=simple
User=seqdesk
WorkingDirectory=/opt/seqdesk
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=8000

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable seqdesk
sudo systemctl start seqdesk
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name seqdesk.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name seqdesk.example.com;

    ssl_certificate /etc/letsencrypt/live/seqdesk.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seqdesk.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Troubleshooting

### Node.js Issues

**Error: "Cannot find module"**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Error: "EACCES permission denied"**
```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Database Issues

**Error: "Database not found"**
```bash
npx prisma db push
npx prisma db seed
```

**Reset database completely:**
```bash
rm -f dev.db
npx prisma db push
npx prisma db seed
```

### Conda/Pipeline Issues

**Nextflow not found:**
```bash
# Check if nextflow is in PATH
which nextflow

# If not, add to PATH
export PATH="$HOME/miniconda3/bin:$PATH"
```

**Conda environment issues:**
```bash
# Verify conda is initialized
conda info

# Re-initialize if needed
conda init bash
source ~/.bashrc
```

**Pipeline fails with memory error:**

Edit `seqdesk.config.json` to increase resources:
```json
{
  "pipelines": {
    "execution": {
      "slurm": {
        "enabled": true,
        "memory": "128GB",
        "cores": 16
      }
    }
  }
}
```

### Port Already in Use

```bash
# Find process using port 8000 (or 3000 if you did not set PORT)
lsof -i :8000

# Kill it
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Config Not Loading

```bash
# Verify config file exists and is valid JSON
cat seqdesk.config.json | jq .

# Check environment variables
env | grep SEQDESK

# View loaded config in Admin UI
# Go to Platform Settings > General > Configuration Status
```

---

## Next Steps

After installation:

1. **Configure Data Storage** - Log in as admin, go to Admin > Data Storage, and set data paths.
2. **Configure Pipeline Runtime** - If pipelines are enabled, go to Admin > Pipeline Runtime.
3. **Configure your facility** - Set site name and other options in Admin Settings.
4. **Set up departments** - Create departments for your organization.
5. **Invite users** - Create researcher accounts or enable registration.
6. **Configure pipelines** - Enable and test nf-core/mag pipeline.
7. **Set up ENA** - Configure ENA credentials for data submission.

For more information, see:
- [Configuration Reference](configuration.md)
- [Adding Pipelines](adding-pipelines.md)
- [ENA Integration](ena-integration-plan.md)
