# @summary Install Node.js 18+, npm, and Git per installation.md
# Uses NodeSource for Node 20 on Debian/Ubuntu and RHEL/CentOS.
#
class seqdesk::prerequisites {
  $install_dir = $seqdesk::install_dir
  $user        = $seqdesk::user
  $group       = $seqdesk::group

  # Git (required for clone)
  package { 'git':
    ensure => installed,
  }

  # Node.js 20 via NodeSource (matches installation.md)
  case $facts['os']['family'] {
    'Debian': {
      exec { 'nodesource-setup-deb':
        command => '/usr/bin/curl -fsSL https://deb.nodesource.com/setup_20.x | /usr/bin/bash -',
        creates => '/etc/apt/sources.list.d/nodesource.list',
        require => Package['curl'],
      }
      package { 'nodejs':
        ensure  => installed,
        require => Exec['nodesource-setup-deb'],
      }
    }
    'RedHat': {
      exec { 'nodesource-setup-rpm':
        command => '/usr/bin/curl -fsSL https://rpm.nodesource.com/setup_20.x | /usr/bin/bash -',
        creates => '/etc/yum.repos.d/nodesource*.repo',
        require => Package['curl'],
      }
      package { 'nodejs':
        ensure  => installed,
        require => Exec['nodesource-setup-rpm'],
      }
    }
    default: {
      package { 'nodejs':
        ensure => installed,
      }
    }
  }

  package { 'curl':
    ensure => installed,
  }
}
