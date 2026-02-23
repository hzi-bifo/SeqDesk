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
  if $config_hash != undef {
    file { "${install_dir}/seqdesk.config.json":
      ensure  => file,
      owner   => $user,
      group   => $group,
      mode    => '0644',
      content => stdlib::to_json($config_hash),
      require => Exec['seqdesk-git-clone'],
    }
  } else {
    # Copy from example and optionally patch site.dataBasePath / pipelines
    exec { 'seqdesk-copy-config':
      command => "/bin/cp ${install_dir}/seqdesk.config.example.json ${install_dir}/seqdesk.config.json",
      creates => "${install_dir}/seqdesk.config.json",
      user    => $user,
      cwd     => $install_dir,
      require => Exec['seqdesk-git-clone'],
    }
  }
}
