# @summary Install Node.js 18+, npm, and optionally Git per installation.md
# Uses NodeSource for Node 20 on Debian/Ubuntu and RHEL/CentOS.
# Optionally install extra packages (e.g. htop).
# Set manage_git false if another module installs git.
#
class seqdesk::prerequisites {
  $install_dir    = $seqdesk::install_dir
  $user           = $seqdesk::user
  $group          = $seqdesk::group
  $extra_packages = $seqdesk::extra_packages
  $manage_git     = $seqdesk::manage_git

  if $manage_git {
    package { 'git':
      ensure => installed,
    }
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

  unless empty($extra_packages) {
    $extra_packages.each |String $pkg| {
      package { $pkg:
        ensure => installed,
      }
    }
  }
}
