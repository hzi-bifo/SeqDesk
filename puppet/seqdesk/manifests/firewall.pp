# @summary Optional firewalld: open SeqDesk app port and optional extra ports (e.g. for Nextflow)
# Only included when seqdesk::manage_firewalld is true. Uses firewall-cmd (no puppet-firewalld required).
#
class seqdesk::firewall {
  $port              = $seqdesk::port
  $firewalld_zone    = 
  $firewalld_extra_ports = 

  $port_spec = "${port}/tcp"

  exec { "firewalld-add-port-${port}":
    command => "firewall-cmd --permanent --zone=${firewalld_zone} --add-port=${port_spec}",
    path    => ['/usr/bin', '/usr/sbin'],
    unless  => "firewall-cmd --permanent --zone=${firewalld_zone} --query-port=${port_spec}",
  }

  $firewalld_extra_ports.each |String $extra| {
    $name = "firewalld-add-port-${extra}"
    exec { $name:
      command => "firewall-cmd --permanent --zone=${firewalld_zone} --add-port=${extra}",
      path    => ['/usr/bin', '/usr/sbin'],
      unless  => "firewall-cmd --permanent --zone=${firewalld_zone} --query-port=${extra}",
      notify  => Exec['firewalld-reload'],
    }
  }

  exec { 'firewalld-reload':
    command     => 'firewall-cmd --reload',
    path        => ['/usr/bin', '/usr/sbin'],
    refreshonly => true,
    subscribe   => Exec["firewalld-add-port-${port}"],
  }
}
