# SeqDesk.com Website Concept

## Overview

seqdesk.com serves as:
1. **Landing page** - Product information and features
2. **Distribution hub** - Easy installation via curl script
3. **Documentation** - Links to GitHub docs
4. **Status page** - (Future) Service status for hosted version

---

## Installation Flow

### One-Line Install

```bash
curl -fsSL https://seqdesk.com/install.sh | bash
```

This script:
1. Detects OS (Linux, macOS)
2. Checks/installs Node.js and Git
3. Clones the repository
4. Installs npm dependencies
5. Creates `.env` with generated secret
6. Initializes the database
7. Creates basic `seqdesk.config.json`

### Installation Options

```bash
# Install to custom directory
SEQDESK_DIR=/opt/seqdesk curl -fsSL https://seqdesk.com/install.sh | bash

# Include Miniconda for pipeline support
SEQDESK_WITH_CONDA=1 curl -fsSL https://seqdesk.com/install.sh | bash

# Install specific version/branch
SEQDESK_BRANCH=v1.0.0 curl -fsSL https://seqdesk.com/install.sh | bash
```

---

## Post-Install Setup Wizard

After installation, users can run an interactive setup wizard:

```bash
npm run setup
# or
npx seqdesk-setup
```

### Wizard Steps

#### Step 1: Welcome
```
Welcome to SeqDesk Setup!

This wizard will help you configure your sequencing facility.
You can change these settings later in the Admin UI.

Press Enter to continue...
```

#### Step 2: Facility Information
```
Facility Information
--------------------

? Facility name: [My Sequencing Facility]
? Contact email: [admin@example.com]
? Data storage path: [/data/sequencing]

  Checking path... OK (writable)
```

#### Step 3: Admin Account
```
Admin Account
-------------

? Admin email: [admin@example.com]
? Admin password: ********
? Confirm password: ********

  Creating admin account... OK
```

#### Step 4: Pipeline Configuration
```
Pipeline Configuration
----------------------

Do you want to enable bioinformatics pipelines?
Pipelines require Nextflow and Conda/Docker.

? Enable pipelines: (Y/n)

Checking prerequisites...
  Nextflow: OK (v24.04.0)
  Conda: OK (/opt/miniconda3)

? Pipeline output directory: [/data/pipeline_runs]
? Enable MAG pipeline: (Y/n)
```

#### Step 5: ENA Configuration (Optional)
```
ENA Submission (Optional)
-------------------------

Configure European Nucleotide Archive submission?
Skip this if you don't need ENA integration.

? Configure ENA: (y/N)

[If yes]
? Webin username: [Webin-XXXXX]
? Webin password: ********
? Use test server: (Y/n)
? Center name: [My Institution]
```

#### Step 6: Summary & Start
```
Configuration Complete!
-----------------------

Facility:   My Sequencing Facility
Admin:      admin@example.com
Data path:  /data/sequencing
Pipelines:  Enabled (MAG)
ENA:        Test mode

Configuration saved to seqdesk.config.json

? Start SeqDesk now? (Y/n)

Starting SeqDesk...

  Local:   http://localhost:3000
  Network: http://192.168.1.100:3000

Open your browser and log in with your admin credentials.
Press Ctrl+C to stop the server.
```

---

## Landing Page Structure

### Hero Section
```
SeqDesk
Modern Sequencing Facility Management

Manage orders, track samples, run pipelines,
and submit to ENA - all in one place.

[Get Started]  [View Demo]
```

### Features Section
```
Features
--------

[Order Management]
Create and track sequencing orders with customizable workflows

[Sample Tracking]
Manage samples with MIxS-compliant metadata

[Pipeline Integration]
Run nf-core pipelines with real-time progress

[ENA Submission]
Submit directly to European Nucleotide Archive
```

### Quick Start Section
```
Quick Start
-----------

Install in one command:

  curl -fsSL https://seqdesk.com/install.sh | bash

Or with Docker:

  docker run -p 3000:3000 ghcr.io/hzi-bifo/seqdesk
```

### Footer
```
Documentation | GitHub | License: MIT
Made with care at HZI
```

---

## Website Hosting Options

### Option 1: Static Site on GitHub Pages
- Simple HTML/CSS landing page
- `install.sh` served from GitHub raw
- Free, easy to maintain

### Option 2: Vercel/Netlify
- Static site with edge functions
- Can track download statistics
- Free tier available

### Option 3: Simple VPS
- Full control
- Can host demo instance
- ~$5/month (DigitalOcean, Hetzner)

---

## URLs Structure

```
seqdesk.com/              - Landing page
seqdesk.com/install.sh    - Installation script
seqdesk.com/docs          - Redirect to GitHub docs
seqdesk.com/demo          - (Future) Live demo instance
seqdesk.com/status        - (Future) Status page
```

---

## Install Script Hosting

The install script can be hosted:

### Option A: From GitHub (recommended for now)
```bash
# Redirect seqdesk.com/install.sh to GitHub raw
curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash
```

### Option B: From seqdesk.com directly
```bash
# Host on seqdesk.com with download tracking
curl -fsSL https://seqdesk.com/install.sh | bash
```

---

## Implementation Priority

### Phase 1: Basic Distribution (Now)
- [x] Create install.sh script
- [ ] Test on fresh Linux/macOS
- [ ] Host script on GitHub raw

### Phase 2: Landing Page
- [ ] Simple HTML landing page
- [ ] Deploy to GitHub Pages or Vercel
- [ ] Point seqdesk.com DNS

### Phase 3: Setup Wizard
- [ ] Create interactive CLI wizard
- [ ] Add `npm run setup` command
- [ ] Integrate with config system

### Phase 4: Enhanced Distribution
- [ ] Docker image on ghcr.io
- [ ] Download statistics
- [ ] Version management

---

## Technical Notes

### Install Script Security
- Script is open source, auditable on GitHub
- Uses HTTPS for all downloads
- No sudo required except for system packages
- Creates files only in specified directory

### Versioning
- Script checks `SEQDESK_BRANCH` env var
- Default: `main` branch
- Users can specify tags: `SEQDESK_BRANCH=v1.0.0`

### Offline Installation
For air-gapped environments:
```bash
# On connected machine
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk && npm pack
# Transfer seqdesk-x.x.x.tgz to target

# On target machine
npm install seqdesk-x.x.x.tgz
```
