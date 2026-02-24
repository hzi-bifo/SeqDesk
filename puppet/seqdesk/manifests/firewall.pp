# @summary Optional firewalld: open SeqDesk app port and optional extra ports (e.g. for Nextflow)
# Only included when seqdesk::manage_firewalld is true. Uses firewall-cmd (no puppet-firewalld required).
# Uses distinct resource titles (seqdesk-firewalld-app-*, seqdesk-firewalld-extra-*) to avoid duplicate declaration when port and extra ports overlap.
#
class seqdesk::firewall {
  $port                   = $seqdesk::port
  $firewalld_zone         = $seqdesk::firewalld_zone
  $firewalld_extra_ports  = $seqdesk::firewalld_extra_ports

  $port_spec = "${port}/tcp"
  $app_port_title = "seqdesk-firewalld-app-${port}"

  exec { $app_port_title:
    command => "firewall-cmd --permanent --zone=${firewalld_zone} --add-port=${port_spec}",
    path    => ['/usr/bin', '/usr/sbin'],
    unless  => "firewall-cmd --permanent --zone=${firewalld_zone} --query-port=${port_spec}",
    notify  => Exec['seqdesk-firewalld-reload'],
  }

  $firewalld_extra_ports.each |String $extra| {
    # Sanitize for resource title (no slash)
    $extra_safe = regsubst($extra, '/', '_', 'G')
    $extra_title = "seqdesk-firewalld-extra-${extra_safe}"
    exec { $extra_title:
      command => "firewall-cmd --permanent --zone=${firewalld_zone} --add-port=${extra}",
      path    => ['/usr/bin', '/usr/sbin'],
      unless  => "firewall-cmd --permanent --zone=${firewalld_zone} --query-port=${extra}",
      notify  => Exec['seqdesk-firewalld-reload'],
    }
  }

  exec { 'seqdesk-firewalld-reload':
    command     => 'firewall-cmd --reload',
    path        => ['/usr/bin', '/usr/sbin'],
    refreshonly => true,
    subscribe   => Exec[$app_port_title],
  }
}
