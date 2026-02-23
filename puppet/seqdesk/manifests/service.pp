# @summary Optional systemd unit for SeqDesk (installation.md - Running in Production)
# Only included when seqdesk::manage_service is true.
#
class seqdesk::service {
  $install_dir = $seqdesk::install_dir
  $user        = $seqdesk::user
  $group       = $seqdesk::group
  $port        = $seqdesk::port

  # Ensure app is built so npm start works
  exec { 'seqdesk-npm-build':
    command     => '/usr/bin/npm run build',
    cwd         => $install_dir,
    user        => $user,
    environment => ['HOME=/tmp', 'NODE_ENV=production'],
    require     => Exec['seqdesk-prisma-seed'],
    unless      => "test -d ${install_dir}/.next",
  }

  file { '/etc/systemd/system/seqdesk.service':
    ensure  => file,
    mode    => '0644',
    content => epp('seqdesk/seqdesk.service.epp', {
      install_dir => $install_dir,
      user        => $user,
      group       => $group,
      port        => $port,
    }),
  }

  exec { 'seqdesk-systemctl-daemon-reload':
    command     => '/usr/bin/systemctl daemon-reload',
    subscribe   => File['/etc/systemd/system/seqdesk.service'],
    refreshonly => true,
  }

  service { 'seqdesk':
    ensure    => running,
    enable    => true,
    subscribe => [File['/etc/systemd/system/seqdesk.service'], Exec['seqdesk-npm-build']],
    require   => Exec['seqdesk-systemctl-daemon-reload'],
  }
}
