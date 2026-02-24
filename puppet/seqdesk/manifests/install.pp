# @summary Clone SeqDesk repo and run npm install (installation.md steps 2)
#
class seqdesk::install {
  $install_dir = $seqdesk::install_dir
  $repo_url   = $seqdesk::repo_url
  $branch     = $seqdesk::branch
  $user       = $seqdesk::user
  $group      = $seqdesk::group

  # Ensure parent directory exists (clone will create $install_dir)
  $parent_dir = dirname($install_dir)
  file { $parent_dir:
    ensure => directory,
    mode   => '0755',
  }

  # Clone repository (depth 1 to match install script)
  exec { 'seqdesk-git-clone':
    command => "/usr/bin/git clone --branch ${branch} --depth 1 ${repo_url} ${install_dir}",
    creates => "${install_dir}/package.json",
    user    => $user,
    require => [Package['git'], File[$parent_dir]],
    cwd     => $parent_dir,
  }

  # Set ownership of install dir (clone ran as $user; this ensures top-level ownership)
  file { $install_dir:
    ensure  => directory,
    owner   => $user,
    group   => $group,
    require => Exec['seqdesk-git-clone'],
  }

  # npm install
  exec { 'seqdesk-npm-install':
    command     => '/usr/bin/npm install',
    cwd         => $install_dir,
    user        => $user,
    environment => ['HOME=/tmp'],
    subscribe   => Exec['seqdesk-git-clone'],
    refreshonly => true,
  }

  # Ensure npm install has run at least once (idempotent: run if node_modules incomplete)
  exec { 'seqdesk-npm-install-once':
    command     => '/usr/bin/npm install',
    cwd         => $install_dir,
    user        => $user,
    environment => ['HOME=/tmp'],
    require     => Exec['seqdesk-git-clone'],
    unless      => "/usr/bin/test -f ${install_dir}/node_modules/.package-lock.json",
  }
}
