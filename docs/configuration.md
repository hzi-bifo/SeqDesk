# SeqDesk Configuration Guide

SeqDesk supports multiple configuration sources, allowing flexible deployment across different environments.

## Configuration Sources

Configuration is loaded from multiple sources with the following priority (highest to lowest):

1. **Environment Variables** (`SEQDESK_*`) - Highest priority, ideal for secrets and deployment-specific overrides
2. **Config File** (`seqdesk.config.json`) - Project-level configuration, can be version controlled
3. **Database Settings** - Editable through the Admin UI
4. **Default Values** - Built-in fallbacks

## Quick Start

1. Copy the example config file:
   ```bash
   cp seqdesk.config.example.json seqdesk.config.json
   ```

2. Edit the config file for your environment:
   ```bash
   vim seqdesk.config.json
   ```

3. Set sensitive values via environment variables:
   ```bash
   export SEQDESK_ENA_PASSWORD="your-webin-password"
   ```

4. Start the application - config is loaded automatically.

## Config File

The config file should be named one of:
- `seqdesk.config.json` (recommended)
- `.seqdeskrc`
- `.seqdeskrc.json`

### Complete Example

```json
{
  "site": {
    "name": "HZI Sequencing Facility",
    "dataBasePath": "/data/sequencing",
    "contactEmail": "sequencing@helmholtz-hzi.de"
  },

  "pipelines": {
    "enabled": true,
    "execution": {
      "mode": "slurm",
      "runDirectory": "/data/pipeline_runs",
      "conda": {
        "enabled": true,
        "path": "/opt/conda",
        "environment": "nf-core"
      },
      "slurm": {
        "enabled": true,
        "queue": "cpu",
        "cores": 8,
        "memory": "64GB",
        "timeLimit": 48
      }
    },
    "mag": {
      "enabled": true,
      "version": "3.4.0"
    }
  },

  "ena": {
    "testMode": false,
    "centerName": "Helmholtz Centre for Infection Research"
  },

  "sequencingFiles": {
    "extensions": [".fastq.gz", ".fq.gz"],
    "scanDepth": 3,
    "allowSingleEnd": true
  }
}
```

## Environment Variables

All settings can be overridden via environment variables with the `SEQDESK_` prefix.

### Site Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_SITE_NAME` | `site.name` | Display name of the facility |
| `SEQDESK_DATA_PATH` | `site.dataBasePath` | Base path for data storage |
| `SEQDESK_CONTACT_EMAIL` | `site.contactEmail` | Facility contact email |

### Pipeline Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_PIPELINES_ENABLED` | `pipelines.enabled` | Enable pipeline features |
| `SEQDESK_PIPELINE_RUN_DIR` | `pipelines.execution.runDirectory` | Output directory for runs |
| `SEQDESK_PIPELINE_MODE` | `pipelines.execution.mode` | `local`, `slurm`, or `kubernetes` |

### Conda Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_CONDA_ENABLED` | `pipelines.execution.conda.enabled` | Use Conda for dependencies |
| `SEQDESK_CONDA_PATH` | `pipelines.execution.conda.path` | Path to Conda installation |
| `SEQDESK_CONDA_ENV` | `pipelines.execution.conda.environment` | Conda environment name |

### SLURM Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_SLURM_ENABLED` | `pipelines.execution.slurm.enabled` | Submit jobs to SLURM |
| `SEQDESK_SLURM_QUEUE` | `pipelines.execution.slurm.queue` | SLURM partition/queue |
| `SEQDESK_SLURM_CORES` | `pipelines.execution.slurm.cores` | CPU cores per job |
| `SEQDESK_SLURM_MEMORY` | `pipelines.execution.slurm.memory` | Memory per job (e.g., `64GB`) |
| `SEQDESK_SLURM_TIME` | `pipelines.execution.slurm.timeLimit` | Time limit in hours |

### MAG Pipeline Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_MAG_ENABLED` | `pipelines.mag.enabled` | Enable MAG pipeline |
| `SEQDESK_MAG_VERSION` | `pipelines.mag.version` | nf-core/mag version |
| `SEQDESK_MAG_STUB` | `pipelines.mag.stubMode` | Use stub mode for testing |

### ENA Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_ENA_TEST_MODE` | `ena.testMode` | Use ENA test server |
| `SEQDESK_ENA_USERNAME` | `ena.username` | Webin account username |
| `SEQDESK_ENA_PASSWORD` | `ena.password` | Webin account password |
| `SEQDESK_ENA_CENTER` | `ena.centerName` | Submission center name |

### Sequencing Files Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_FILES_EXTENSIONS` | `sequencingFiles.extensions` | Comma-separated list |
| `SEQDESK_FILES_SCAN_DEPTH` | `sequencingFiles.scanDepth` | Directory scan depth |
| `SEQDESK_FILES_SINGLE_END` | `sequencingFiles.allowSingleEnd` | Allow single-end reads |

### Authentication Settings

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `SEQDESK_AUTH_REGISTRATION` | `auth.allowRegistration` | Allow public registration |
| `SEQDESK_SESSION_TIMEOUT` | `auth.sessionTimeout` | Session timeout in hours |

## Admin UI Configuration

Settings can also be configured through the Admin UI:

1. Navigate to **Platform Settings** > **General**
2. Edit the desired settings
3. Click **Save**

Settings changed in the UI are stored in the database and take effect immediately. However, they have lower priority than config file and environment variables.

### Viewing Configuration Sources

In the Admin UI, each setting shows its current source:
- **ENV** - Value from environment variable
- **FILE** - Value from config file
- **DB** - Value from database (UI-editable)
- **DEFAULT** - Built-in default value

## Configuration Sections

### Site (`site`)

Basic facility information.

```json
{
  "site": {
    "name": "My Sequencing Facility",
    "dataBasePath": "/data/sequencing",
    "contactEmail": "admin@example.com"
  }
}
```

### Pipelines (`pipelines`)

Pipeline execution configuration.

```json
{
  "pipelines": {
    "enabled": true,
    "execution": {
      "mode": "local",
      "runDirectory": "/data/runs",
      "conda": { "enabled": true, "path": "/opt/conda" },
      "slurm": { "enabled": false }
    },
    "mag": {
      "enabled": true,
      "version": "3.4.0",
      "stubMode": false
    }
  }
}
```

**Execution Modes:**
- `local` - Run pipelines directly on the server
- `slurm` - Submit jobs to a SLURM cluster
- `kubernetes` - Run in Kubernetes (future)

SeqDesk resolves pipeline tools via Conda only; container runtimes are not supported.

### ENA (`ena`)

European Nucleotide Archive submission settings.

```json
{
  "ena": {
    "testMode": true,
    "username": "Webin-XXXXX",
    "centerName": "My Institution"
  }
}
```

**Important:** Never put passwords in the config file. Use the `SEQDESK_ENA_PASSWORD` environment variable or configure via the Admin UI.

### Sequencing Files (`sequencingFiles`)

File discovery and management settings.

```json
{
  "sequencingFiles": {
    "extensions": [".fastq.gz", ".fq.gz"],
    "scanDepth": 2,
    "allowSingleEnd": false,
    "ignorePatterns": ["**/tmp/**"]
  }
}
```

### Authentication (`auth`)

User authentication settings.

```json
{
  "auth": {
    "allowRegistration": true,
    "requireEmailVerification": false,
    "sessionTimeout": 24
  }
}
```

## Best Practices

### 1. Version Control

Include the config file in version control for reproducibility, but exclude secrets:

```gitignore
# .gitignore
seqdesk.config.json
!seqdesk.config.example.json
```

### 2. Environment-Specific Configs

Use different config files per environment:

```bash
# Development
cp seqdesk.config.dev.json seqdesk.config.json

# Production
cp seqdesk.config.prod.json seqdesk.config.json
```

### 3. Secrets Management

Always use environment variables for sensitive data:

```bash
# .env or system environment
SEQDESK_ENA_PASSWORD=secret
NEXTAUTH_SECRET=another-secret
```

## Troubleshooting

### Config Not Loading

1. Check file name is correct (`seqdesk.config.json`)
2. Verify JSON syntax: `cat seqdesk.config.json | jq .`
3. Check file permissions

### Environment Variable Not Working

1. Verify the variable name matches exactly (case-sensitive)
2. Check the variable is exported: `echo $SEQDESK_SITE_NAME`
3. Restart the application after changing environment variables

### Database Settings Ignored

Database settings have lowest priority. If the same setting exists in the config file or environment variable, that value will be used instead.

To see which source each setting comes from, check the Admin UI or use the API:

```bash
curl http://localhost:3000/api/admin/config/status
```
