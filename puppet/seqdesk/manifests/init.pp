# @summary Install and configure SeqDesk per docs/installation.md
#
# @param install_dir Directory to install SeqDesk (default: /opt/seqdesk)
# @param repo_url Git repository URL
# @param branch Git branch to clone (default: main)
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
# @param config_source Optional path or URI to a JSON file to use as seqdesk.config.json. Use this instead of config_hash to reference a file. Examples: 'file:///etc/seqdesk/config.json', 'puppet:///modules/mymodule/seqdesk.config.json'. If both config_source and config_hash are set, config_source wins.
#
class seqdesk (
  String $install_dir                          = '/opt/seqdesk',
  String $repo_url                             = 'https://github.com/hzi-bifo/SeqDesk.git',
  String $branch                               = 'main',
  String $user                                 = 'seqdesk',
  String $group                                = 'seqdesk',
  Integer[1, 65535] $port                      = 8000,
  Optional[String] $nextauth_secret            = undef,
  Optional[String] $nextauth_url               = undef,
  String $database_url                         = 'file:./dev.db',
  Boolean $with_pipelines                      = false,
  Optional[String] $conda_path                 = undef,
  Optional[String] $data_path                  = undef,
  Optional[String] $run_dir                    = undef,
  Boolean $manage_service                     = false,
  Optional[Hash] $config_hash                  = undef,
  Optional[String] $config_source              = undef,
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

  include seqdesk::prerequisites
  include seqdesk::install
  include seqdesk::config
  include seqdesk::database

  Class['seqdesk::prerequisites']
  -> Class['seqdesk::install']
  -> Class['seqdesk::config']
  -> Class['seqdesk::database']

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
