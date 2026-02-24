# @summary Deploy .env and seqdesk.config.json (installation.md steps 3 and 4)
#
class seqdesk::config {
  $install_dir       = $seqdesk::install_dir
  $user              = $seqdesk::user
  $group             = $seqdesk::group
  $port              = $seqdesk::port
  $nextauth_secret   = $seqdesk::nextauth_secret
  $effective_nextauth_url = $seqdesk::effective_nextauth_url
  $database_url      = $seqdesk::database_url
  $config_hash       = $seqdesk::config_hash
  $config_source     = $seqdesk::config_source
  $effective_data_path   = $seqdesk::effective_data_path
  $effective_run_dir     = $seqdesk::effective_run_dir
  $with_pipelines    = $seqdesk::with_pipelines
  $effective_conda_path  = $seqdesk::effective_conda_path

  # .env from template (installation.md step 3)
  $secret = $nextauth_secret ? {
    undef   => 'REPLACE-WITH-openssl-rand-base64-32',
    default => $nextauth_secret,
  }
  file { "${install_dir}/.env":
    ensure  => file,
    owner   => $user,
    group   => $group,
    mode    => '0640',
    content => epp('seqdesk/env.epp', {
      database_url    => $database_url,
      nextauth_url     => $effective_nextauth_url,
      nextauth_secret  => $secret,
      port             => $port,
    }),
    require => Exec['seqdesk-git-clone'],
  }

  # seqdesk.config.json (installation.md step 4)
  if $config_source != undef and $config_source != '' {
    # Path relative to clone: puppet:///modules/seqdesk/... (strip prefix) or bare relative path. Copy on agent via exec to avoid file:// being resolved on server.
    $config_repo_relative = $config_source ? {
      /^puppet:\/\/\/modules\/seqdesk\// => regsubst($config_source, '^puppet:///modules/seqdesk/', ''),
      /^(file:\/\/|puppet:\/\/|\/)/      => undef,
      default                             => $config_source,
    }
    if $config_repo_relative != undef and $config_repo_relative != '' {
      $config_src_path = "${install_dir}/${config_repo_relative}"
      exec { 'seqdesk-copy-config-from-repo':
        command => "/bin/cp ${config_src_path} ${install_dir}/seqdesk.config.json && /usr/bin/chown ${user}:${group} ${install_dir}/seqdesk.config.json",
        creates => "${install_dir}/seqdesk.config.json",
        user    => 'root',
        require => Exec['seqdesk-git-clone'],
      }
      file { "${install_dir}/seqdesk.config.json":
        ensure  => file,
        owner   => $user,
        group   => $group,
        mode    => '0644',
        require => Exec['seqdesk-copy-config-from-repo'],
      }
    } else {
      # file:/// or puppet:/// (other) or absolute path: use File source
      $config_source_uri = $config_source ? {
        /^(file:\/\/|puppet:\/\/)/ => $config_source,
        /^\//                       => "file://${config_source}",
        default                     => "file://${config_source}",
      }
      file { "${install_dir}/seqdesk.config.json":
        ensure  => file,
        owner   => $user,
        group   => $group,
        mode    => '0644',
        source  => $config_source_uri,
        require => Exec['seqdesk-git-clone'],
      }
    }
  } elsif $config_hash != undef {
    file { "${install_dir}/seqdesk.config.json":
      ensure  => file,
      owner   => $user,
      group   => $group,
      mode    => '0644',
      content => stdlib::to_json($config_hash),
      require => Exec['seqdesk-git-clone'],
    }
  } else {
    # Copy from example
    exec { 'seqdesk-copy-config':
      command => "/bin/cp ${install_dir}/seqdesk.config.example.json ${install_dir}/seqdesk.config.json",
      creates => "${install_dir}/seqdesk.config.json",
      user    => $user,
      cwd     => $install_dir,
      require => Exec['seqdesk-git-clone'],
    }
  }
}
