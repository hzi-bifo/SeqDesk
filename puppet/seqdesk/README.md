# seqdesk Puppet module

This module installs and configures [SeqDesk](https://github.com/hzi-bifo/SeqDesk) according to the steps in [docs/installation.md](../../docs/installation.md).

## Requirements

- Puppet 7+
- [puppetlabs-stdlib](https://forge.puppet.com/puppetlabs/stdlib)
- Supported OS: Debian/Ubuntu, RHEL/CentOS (Node.js is installed via NodeSource)

## Usage

Include the class with defaults (install to `/opt/seqdesk`, port 8000, no pipelines, no service):

```puppet
include seqdesk
```

With parameters (Hiera or direct):

```puppet
class { 'seqdesk':
  install_dir      => '/opt/seqdesk',
  user             => 'seqdesk',
  group            => 'seqdesk',
  port             => 8000,
  nextauth_secret  => lookup('seqdesk::nextauth_secret'),  # or pass a string
  with_pipelines   => true,
  manage_service   => true,
}
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `install_dir` | String | `/opt/seqdesk` | Installation directory |
| `repo_url` | String | `https://github.com/hzi-bifo/SeqDesk.git` | Git repository URL |
| `branch` | String | `main` | Git branch to clone |
| `user` | String | `seqdesk` | User that owns the app and runs it |
| `group` | String | `seqdesk` | Group for install directory |
| `port` | Integer | `8000` | Application port |
| `nextauth_secret` | Optional[String] | `undef` | NextAuth secret (use `openssl rand -base64 32`). If undef, a placeholder is written; replace before first start. |
| `nextauth_url` | Optional[String] | `undef` | Full URL (e.g. `http://localhost:8000`). Defaults to `http://localhost:${port}`. |
| `database_url` | String | `file:./dev.db` | Database URL |
| `with_pipelines` | Boolean | `false` | If true, install Miniconda and run `scripts/setup-conda-env.sh` |
| `conda_path` | Optional[String] | `undef` | Path to Conda/Miniconda (default `/opt/miniconda3`). If missing and `with_pipelines` true, Miniconda is installed here. |
| `data_path` | Optional[String] | `undef` | Site data base path (default `${install_dir}/data`) |
| `run_dir` | Optional[String] | `undef` | Pipeline run directory (default `${install_dir}/pipeline_runs`) |
| `manage_service` | Boolean | `false` | If true, install systemd unit and enable/start SeqDesk |
| `config_hash` | Optional[Hash] | `undef` | Optional hash to render `seqdesk.config.json`. If undef, the repo's example config is copied. |
| `config_source` | Optional[String] | `undef` | Optional path or URI to a JSON file to use as `seqdesk.config.json`. Use instead of `config_hash` to reference a file. Examples: `file:///etc/seqdesk/config.json`, `puppet:///modules/mymodule/seqdesk.config.json`, or an absolute path (treated as `file://`). If both `config_source` and `config_hash` are set, `config_source` wins. |

## Steps applied (per installation.md)

1. **Prerequisites** – Install Git, Node.js 20 (via NodeSource on Debian/RHEL), npm.
2. **Clone and install** – Clone repo (depth 1) into `install_dir`, run `npm install`.
3. **Config** – Deploy `.env` from template (PORT, NEXTAUTH_URL, NEXTAUTH_SECRET, DATABASE_URL). Deploy or copy `seqdesk.config.json`.
4. **Database** – Run `npx prisma db push` and `npx prisma db seed`.
5. **Conda (optional)** – If `with_pipelines` is true: install Miniconda (if needed), then run `scripts/setup-conda-env.sh --yes --write-config --pipelines-enabled` with data/run paths.
6. **Service (optional)** – If `manage_service` is true: build app and install systemd unit, enable and start service.

## Before first run

- Ensure the `seqdesk` user and group exist (create them in Puppet or separately).
- Set `nextauth_secret` to a secure value (e.g. from Hiera with a generated or secret value).
- If using `config_hash`, pass a hash that matches the [SeqDesk config schema](../../docs/seqdesk-config-schema.json) (or leave undef to use the copied example). Alternatively use `config_source` to point to a JSON file (local path or Puppet file URI).

## Example: minimal with service and pipelines

```puppet
# Create user/group
group { 'seqdesk': ensure => present }
user { 'seqdesk':
  ensure => present,
  gid    => 'seqdesk',
  home   => '/opt/seqdesk',
  shell  => '/bin/bash',
}

class { 'seqdesk':
  nextauth_secret => 'your-secret-from-openssl-rand-base64-32',
  with_pipelines  => true,
  manage_service  => true,
}
```
