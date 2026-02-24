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
| `manage_install_parent_dir` | Boolean | `true` | If true, ensure the parent of `install_dir` exists in the install class. Set to `false` when that parent is already created by `ensure_directories` or mounts to avoid duplicate `File` and dependency cycles. |
| `repo_url` | String | `https://github.com/hzi-bifo/SeqDesk.git` | Git repository URL |
| `branch` | String | `main` | Git branch to clone |
| `manage_git` | Boolean | `true` | If true, install the git package. Set to `false` if another module manages git. |
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
| `config_source` | Optional[String] | `undef` | Path or URI for `seqdesk.config.json`. Use instead of `config_hash`. **Relative paths** (e.g. `setups/twincore/seqdesk.config.example.json`) are copied from the cloned repo under `install_dir`. Absolute paths and `file:///` or `puppet:///` URIs are used as-is. If both `config_source` and `config_hash` are set, `config_source` wins. |
| `manage_firewalld` | Boolean | `false` | If true, open `port` and `firewalld_extra_ports` in firewalld. Requires firewalld on the node (e.g. RHEL/CentOS). |
| `firewalld_zone` | String | `public` | Firewalld zone for port rules. |
| `firewalld_extra_ports` | Array[String] | `[]` | Extra port specs to open, e.g. `['60001-63000/tcp']` for Nextflow. |
| `ensure_directories` | Array[String] | `[]` | Directory paths to create (owner/group from `user`/`group`). E.g. `['/net/broker', '/net/broker/env']` for NFS or shared paths. |
| `mounts` | Array[Hash] | `[]` | Mount points. Each hash: `path`, `device`, `fstype`, `options` (optional). In YAML use `key: value` (not Ruby `=>`). See example below. |
| `manage_mount_point_dirs` | Boolean | `true` | If true, create each mount point directory before mounting. Set to `false` when the directory is created elsewhere (e.g. by `ensure_directories` or another module) to avoid duplicate resource or conflict. |
| `extra_packages` | Array[String] | `[]` | Extra packages to install (e.g. `['htop']`). |
| `user_home` | Optional[String] | `undef` | Home directory for `user` (default `/home/${user}`). Used for `.bashrc`/`.bash_profile` when set. |
| `bashrc_source` | Optional[String] | `undef` | If set, manage `${user_home}/.bashrc`. Use `seqdesk` or `puppet:///modules/seqdesk/bashrc.erb` to render the module ERB template (templates/bashrc.erb); otherwise use a file URI (e.g. `puppet:///modules/profile/seqdesk_bashrc`). |
| `bash_profile_source` | Optional[String] | `undef` | If set, manage `${user_home}/.bash_profile` from this source. |
| `puppet_conf_path` | Optional[String] | `undef` | If set, manage this file (e.g. `/etc/puppetlabs/puppet/puppet.conf`). When neither `puppet_conf_source` nor `puppet_conf_content` is set, the module ERB template (templates/puppet.conf.erb) is used. |
| `puppet_conf_source` | Optional[String] | `undef` | Source for puppet.conf. Use `seqdesk` or `puppet:///modules/seqdesk/puppet.conf` (or `.erb`) to render the module ERB template; otherwise a file URI. |
| `puppet_conf_content` | Optional[String] | `undef` | Content for the puppet.conf file (overrides source when set). |
| `sudoers_path` | Optional[String] | `undef` | If set with `sudoers_source` or `sudoers_content`, manage this sudoers fragment (e.g. `/etc/sudoers.d/seqdesk`). |
| `sudoers_source` | Optional[String] | `undef` | Source for the sudoers fragment. |
| `sudoers_content` | Optional[String] | `undef` | Content for the sudoers fragment. |
| `ssh_config_source` | Optional[String] | `undef` | If set, manage `${user_home}/.ssh/config` from this source (e.g. `puppet:///modules/profile/ssh_config`). |
| `ssh_keys` | Array[Hash] | `[]` | SSH key pairs under `${user_home}/.ssh/`. Each hash: `path` => basename; private key from **`private_lookup`** => Hiera lookup key (e.g. `seqdesk_ssh_private_key`) for content from lookup(), or `private_source` => puppet URI; `public_source` => puppet URI (optional). Private key mode 0600, public 0644. |

## Steps applied (per installation.md)

1. **Prerequisites** – Install Git, Node.js 20 (via NodeSource on Debian/RHEL), npm.
2. **Clone and install** – Clone repo (depth 1) into `install_dir`, run `npm install`.
3. **Config** – Deploy `.env` from template (PORT, NEXTAUTH_URL, NEXTAUTH_SECRET, DATABASE_URL). Deploy or copy `seqdesk.config.json`.
4. **Database** – Run `npx prisma db push` and `npx prisma db seed`.
5. **Conda (optional)** – If `with_pipelines` is true: install Miniconda (if needed), then run `scripts/setup-conda-env.sh --yes --write-config --pipelines-enabled` with data/run paths.
6. **Service (optional)** – If `manage_service` is true: build app and install systemd unit, enable and start service.

**Optional (from legacy broker-style deployments):**

- **Mounts** – If `mounts` is non-empty: ensure mount point dirs exist and mount NFS (or other) filesystems (e.g. `/net/broker`).
- **Directories** – If `ensure_directories` is non-empty: create listed directories with `user`/`group` ownership (e.g. `/net/broker/env`).
- **Firewalld** – If `manage_firewalld` is true: open app port and `firewalld_extra_ports` (e.g. 8000 and 60001–63000/tcp for Nextflow).
- **Extra packages** – If `extra_packages` is non-empty: install listed packages (e.g. `htop`).
- **User shell / puppet.conf / sudoers / SSH** – If `bashrc_source`, `bash_profile_source`, puppet/sudoers path+source/content, `ssh_config_source`, or `ssh_keys` are set: manage the corresponding files (legacy broker-style). For SSH: ensures `${user_home}/.ssh` (0700), then `.ssh/config` and each key pair (private + optional public).

## Before first run

- Ensure the `seqdesk` user and group exist (create them in Puppet or separately).
- Set `nextauth_secret` to a secure value (e.g. from Hiera with a generated or secret value).
- If using `config_hash`, pass a hash that matches the [SeqDesk config schema](../../docs/seqdesk-config-schema.json) (or leave undef to use the copied example). Use `config_source` for a file: a path relative to the clone (e.g. `setups/twincore/seqdesk.config.example.json`) is copied from the repo; absolute path or `file:///`/`puppet:///` URIs are used as given.

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

## Example: broker-style (NFS, firewalld, extra dirs)

```yaml
# Hiera – same layout as legacy broker where app and data live under NFS
seqdesk::install_dir: '/net/broker/env/seqdesk'
seqdesk::manage_install_parent_dir: false   # parent /net/broker/env is created by ensure_directories; avoids dependency cycle
seqdesk::user: 'seqdesk'
seqdesk::group: 'seqdesk'
seqdesk::port: 8000
seqdesk::nextauth_secret: '%{lookup("seqdesk_nextauth_secret")}'
seqdesk::with_pipelines: true
seqdesk::conda_path: '/net/broker/env/miniconda3'
seqdesk::manage_service: true
seqdesk::manage_firewalld: true
seqdesk::firewalld_extra_ports:
  - '60001-63000/tcp'
seqdesk::ensure_directories:
  - '/net/broker'
  - '/net/broker/env'
seqdesk::mounts:
  - path: '/net/broker'
    device: '192.168.8.82:/net/broker'
    fstype: 'nfs'
    options: 'rw,async,hard,intr,vers=4.2,_netdev'
seqdesk::extra_packages:
  - 'htop'
```

**YAML syntax:** Use `key: value` (colon and space). Do not use Ruby-style `=>` in node/Hiera YAML or you will get "expected ',' or '}', but got <scalar>" from the parser. For `mounts`, each entry must be a block (key-value pairs with colons), not an inline hash with `=>`.

Example that includes both `/net/broker` and `/home` mounts (valid YAML for a node file):

```yaml
seqdesk::mounts:
  - path: '/net/broker'
    device: '192.168.8.82:/net/broker'
    fstype: 'nfs'
    options: 'rw,async,hard,intr,vers=4.2,_netdev'
  - path: '/home'
    device: '192.168.8.82:/home'
    fstype: 'nfs'
    options: 'rw,async,hard,intr,vers=4.2,_netdev'
seqdesk::firewalld_extra_ports:
  - '60001-63000/tcp'
seqdesk::extra_packages:
  - 'htop'
```

## Example: broker-style user config and sudoers

```yaml
# Optional: use module templates for .bashrc and puppet.conf (no external files needed)
seqdesk::user_home: '/home/seqdesk'
seqdesk::bashrc_source: 'seqdesk'   # or puppet:///modules/seqdesk/bashrc.erb - renders templates/bashrc.erb
seqdesk::puppet_conf_path: '/etc/puppetlabs/puppet/puppet.conf'   # renders templates/puppet.conf.erb when source/content unset

# Or use your own profile module for custom content:
# seqdesk::bashrc_source: 'puppet:///modules/profile/seqdesk_bashrc'
# seqdesk::puppet_conf_source: 'puppet:///modules/profile/seqdesk_puppet.conf'

seqdesk::bash_profile_source: 'puppet:///modules/profile/seqdesk_bash_profile'
seqdesk::sudoers_path: '/etc/sudoers.d/seqdesk'
seqdesk::sudoers_source: 'puppet:///modules/profile/seqdesk_sudoers'
seqdesk::ssh_config_source: 'puppet:///modules/profile/ssh_config'
seqdesk::ssh_keys:
  - path: 'id_ed25519_seqdesk'
    private_lookup: 'seqdesk_ssh_private_key'   # content from Hiera/eyaml; or use private_source with a puppet URI
    public_source: 'puppet:///modules/profile/id_ed25519_seqdesk.pub'
```

Define the lookup key (e.g. `seqdesk_ssh_private_key`) in Hiera with the private key content; use Hiera eyaml to encrypt it. The lookup is passed to `lookup()` so any lookup option (e.g. `lookup_options` for merge/strategy) applies.

**Using module templates:** Set `bashrc_source: 'seqdesk'` or `puppet:///modules/seqdesk/bashrc.erb` (and similarly for puppet.conf) to render the built-in ERB templates (`templates/bashrc.erb`, `templates/puppet.conf.erb`). For custom content, put files in your own module (e.g. `profile`) and set sources to e.g. `puppet:///modules/profile/seqdesk_bashrc`. Do **not** use `puppet:///modules/seqdesk/...` with a file that does not exist in the module; use `seqdesk` to use the built-in templates instead.

For SSH keys: use a module the Puppet server can read (e.g. profile). If the server reports "Permission denied" when retrieving a private key, the file in `files/` may have restrictive permissions (e.g. 0600) that the Puppet server user cannot read; store keys in a secure location the server can access, or use content from Hiera (e.g. eyaml) instead of file sources.

For content from a template use `puppet_conf_content` / `sudoers_content` with a template() in Hiera or in your manifest.

## Troubleshooting

- **Could not retrieve... puppet:///modules/seqdesk/bashrc.erb** (or **puppet.conf**, or **id_ed25519_...**)  
  You set a source to the `seqdesk` module. This module does not ship those files. Create a site module (e.g. `profile`), add the file under `files/`, and set e.g. `seqdesk::bashrc_source: 'puppet:///modules/profile/seqdesk_bashrc'`.

- **Error 500 on SERVER: Permission denied - .../modules/seqdesk/files/id_ed25519_...**  
  The Puppet server cannot read the private key file (e.g. it is mode 0600 and not readable by the server user). Put the key in a module or path the server can read, or deliver the key content via Hiera (e.g. eyaml) and use a `content`-based approach instead of `source`.
