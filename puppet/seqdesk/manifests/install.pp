# @summary Clone SeqDesk repo and run npm install (installation.md steps 2)
# Set manage_install_parent_dir false when the parent of install_dir is created by ensure_directories or mounts to avoid duplicate File and dependency cycles.
#
class seqdesk::install {
  $install_dir               = $seqdesk::install_dir
  $repo_url                  = $seqdesk::repo_url
  $branch                    = $seqdesk::branch
  $user                      = $seqdesk::user
  $group                     = $seqdesk::group
  $manage_git                = $seqdesk::manage_git
  $manage_install_parent_dir = $seqdesk::manage_install_parent_dir

  $parent_dir = dirname($install_dir)

  if $manage_install_parent_dir {
    file { $parent_dir:
      ensure => directory,
      mode   => '0755',
    }
  }

  $git_clone_require = $manage_install_parent_dir ? {
    true  => $manage_git ? {
      true  => [Package['git'], File[$parent_dir]],
      false => File[$parent_dir],
    },
    false => $manage_git ? {
      true  => [Package['git']],
      false => [],
    },
  }

  # Clone repository (depth 1 to match install script). Git must be installed (by this module or another). Parent dir must exist when manage_install_parent_dir is false (e.g. from ensure_directories).
  exec { 'seqdesk-git-clone':
    command => "/usr/bin/git clone --branch ${branch} --depth 1 ${repo_url} ${install_dir}",
    creates => "${install_dir}/package.json",
    user    => $user,
    require => $git_clone_require,
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
