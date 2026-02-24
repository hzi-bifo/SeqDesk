# @summary Install and configure SeqDesk per docs/installation.md
#
# @param install_dir Directory to install SeqDesk (default: /opt/seqdesk)
# @param manage_install_parent_dir If true (default), ensure the parent of install_dir exists in the install class. Set false when that parent is already created by ensure_directories or mounts to avoid duplicate resource and dependency cycles.
# @param repo_url Git repository URL
# @param branch Git branch to clone (default: main)
# @param manage_git If true, install the git package (default: true). Set false if another module manages git.
# @param user User to run the application (default: seqdesk). Must exist.
# @param group Group for install_dir (default: seqdesk). Must exist.
# @param port Application port (default: 8000)
# @param nextauth_secret NextAuth secret (generate with openssl rand -base64 32). If undef, a placeholder is written.
# @param nextauth_url Full URL e.g. http://localhost:8000 (default derived from port)
# @param database_url Database URL (default: file:./dev.db)
# @param with_pipelines Enable pipeline support and run setup-conda-env.sh (default: false)
# @param conda_path Path to Conda/Miniconda (used when with_pipelines true; default: /opt/miniconda3)
# @param data_path Site data base path for pipelines (default: ${install_dir}/data)
# @param run_dir Pipeline run directory (default: ${install_dir}/pipeline_runs)
# @param manage_service If true, install systemd unit and enable service (default: false)
# @param config_hash Optional hash to render seqdesk.config.json (site, pipelines, etc.). If undef, copy from example.
# @param config_source Path or URI for seqdesk.config.json. Relative paths (e.g. setups/twincore/seqdesk.config.example.json) are copied from the cloned repo; file:/// or puppet:/// or absolute paths used as-is. If both config_source and config_hash are set, config_source wins.
# @param manage_firewalld If true, open port (and firewalld_extra_ports) in firewalld (default: false). Requires firewalld on the node.
# @param firewalld_zone Firewalld zone for port rules (default: public).
# @param firewalld_extra_ports Optional array of port specs to open, e.g. ['60001-63000/tcp'] for Nextflow.
# @param ensure_directories Optional array of directory paths to create (owner/group from user/group). E.g. ['/net/broker', '/net/broker/env'].
# @param mounts Optional array of hashes for mount points. Each hash: path, device, fstype, options (optional). E.g. [{'path'=>'/net/broker','device'=>'192.168.8.82:/net/broker','fstype'=>'nfs','options'=>'rw,async,hard,intr,vers=4.2,_netdev'}].
# @param manage_mount_point_dirs If true (default), create each mount point directory before mounting. Set false if the directory is created elsewhere (e.g. ensure_directories or another module) to avoid duplicate resource or conflict.
# @param extra_packages Optional array of package names to install (e.g. ['htop']).
# @param user_home Home directory for user (default /home/${user}). Used for .bashrc/.bash_profile when set.
# @param bashrc_source Optional source for ${user_home}/.bashrc. Use 'seqdesk' or puppet:///modules/seqdesk/bashrc.erb to render module ERB template; or a file URI (e.g. puppet:///modules/profile/seqdesk_bashrc).
# @param bash_profile_source Optional source for ${user_home}/.bash_profile.
# @param puppet_conf_path Optional path to puppet.conf to manage (e.g. /etc/puppetlabs/puppet/puppet.conf). If set and no source/content given, module ERB template is used.
# @param puppet_conf_source Optional source for puppet.conf. Use 'seqdesk' or puppet:///modules/seqdesk/puppet.conf to render module ERB template; or a file URI.
# @param puppet_conf_content Optional content for puppet.conf file.
# @param sudoers_path Optional path for sudoers fragment (e.g. /etc/sudoers.d/seqdesk). Requires sudoers_source or sudoers_content.
# @param sudoers_source Optional source for sudoers fragment.
# @param sudoers_content Optional content for sudoers fragment.
# @param ssh_config_source Optional source for ${user_home}/.ssh/config (e.g. 'puppet:///modules/profile/ssh_config').
# @param ssh_keys Optional array of hashes for SSH key pairs. Each hash: 'path' => basename under .ssh (e.g. 'id_ed25519_deploy'); for the private key use either 'private_source' => puppet URI or 'private_lookup' => Hiera lookup key (e.g. 'seqdesk_ssh_private_key') to supply content from lookup(); 'public_source' => puppet URI (optional). Private key gets mode 0600, public 0644.
#
class seqdesk (
  String $install_dir                          = '/opt/seqdesk',
  Boolean $manage_install_parent_dir            = true,
  String $repo_url                             = 'https://github.com/hzi-bifo/SeqDesk.git',
  String $branch                                = 'main',
  Boolean $manage_git                          = true,
  String $user                                 = 'seqdesk',
  String $group                                = 'seqdesk',
  Integer[1, 65535] $port                      = 8000,
  Optional[String] $nextauth_secret            = undef,
  Optional[String] $nextauth_url               = undef,
  String $database_url                         = 'file:./dev.db',
  Boolean $with_pipelines                       = false,
  Optional[String] $conda_path                 = undef,
  Optional[String] $data_path                  = undef,
  Optional[String] $run_dir                    = undef,
  Boolean $manage_service                      = false,
  Optional[Hash] $config_hash                 = undef,
  Optional[String] $config_source             = undef,
  Boolean $manage_firewalld                    = false,
  String $firewalld_zone                       = 'public',
  Array[String] $firewalld_extra_ports         = [],
  Array[String] $ensure_directories            = [],
  Array[Hash] $mounts                          = [],
  Boolean $manage_mount_point_dirs            = true,
  Array[String] $extra_packages               = [],
  Optional[String] $user_home                 = undef,
  Optional[String] $bashrc_source             = undef,
  Optional[String] $bash_profile_source       = undef,
  Optional[String] $puppet_conf_path           = undef,
  Optional[String] $puppet_conf_source         = undef,
  Optional[String] $puppet_conf_content       = undef,
  Optional[String] $sudoers_path               = undef,
  Optional[String] $sudoers_source            = undef,
  Optional[String] $sudoers_content           = undef,
  Optional[String] $ssh_config_source         = undef,
  Array[Hash] $ssh_keys                       = [],
) {
  $effective_nextauth_url = $nextauth_url ? {
    undef   => "http://localhost:${port}",
    default => $nextauth_url,
  }
  $effective_data_path = $data_path ? {
    undef   => "${install_dir}/data",
    default => $data_path,
  }
  $effective_run_dir = $run_dir ? {
    undef   => "${install_dir}/pipeline_runs",
    default => $run_dir,
  }
  $effective_conda_path = $conda_path ? {
    undef   => '/opt/miniconda3',
    default => $conda_path,
  }

  if !empty($mounts) {
    include seqdesk::mounts
  }
  if !empty($ensure_directories) {
    include seqdesk::directories
  }
  include seqdesk::prerequisites
  include seqdesk::install
  include seqdesk::config
  include seqdesk::database

  if !empty($mounts) {
    Class['seqdesk::mounts'] -> Class['seqdesk::prerequisites']
  }
  if !empty($ensure_directories) {
    Class['seqdesk::directories'] -> Class['seqdesk::prerequisites']
    # Directories before mounts so ensure_directories can create mount points when manage_mount_point_dirs is false
    if !empty($mounts) {
      Class['seqdesk::directories'] -> Class['seqdesk::mounts']
    }
  }
  Class['seqdesk::prerequisites']
  -> Class['seqdesk::install']
  -> Class['seqdesk::config']
  -> Class['seqdesk::database']

  if $manage_firewalld {
    include seqdesk::firewall
  }

  $optional_config = $bashrc_source != undef or $bash_profile_source != undef or
    ($puppet_conf_path != undef and $puppet_conf_path != '') or
    ($sudoers_path != undef and ($sudoers_source != undef or $sudoers_content != undef)) or
    $ssh_config_source != undef or !empty($ssh_keys)
  if $optional_config {
    include seqdesk::optional_config
    # SSH keys and user config must be in place before git clone (install runs as $user)
    Class['seqdesk::optional_config'] -> Class['seqdesk::prerequisites']
    Class['seqdesk::optional_config'] -> Class['seqdesk::install']
  }

  if $with_pipelines {
    include seqdesk::conda
    Class['seqdesk::database'] -> Class['seqdesk::conda']
  }

  if $manage_service {
    include seqdesk::service
    Class['seqdesk::database'] -> Class['seqdesk::service']
    if $with_pipelines {
      Class['seqdesk::conda'] -> Class['seqdesk::service']
    }
  }
}
