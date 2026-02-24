# @summary Optional: manage user shell config (.bashrc, .bash_profile), puppet.conf, sudoers fragment, and SSH config/keys
# Only manages each file when the corresponding source/content parameter is set (legacy broker-style).
#
class seqdesk::optional_config {
  $user                = $seqdesk::user
  $group               = $seqdesk::group
  $user_home           = $seqdesk::user_home
  $bashrc_source       = $seqdesk::bashrc_source
  $bash_profile_source = $seqdesk::bash_profile_source
  $puppet_conf_path    = $seqdesk::puppet_conf_path
  $puppet_conf_source  = $seqdesk::puppet_conf_source
  $puppet_conf_content = $seqdesk::puppet_conf_content
  $sudoers_path        = $seqdesk::sudoers_path
  $sudoers_source      = $seqdesk::sudoers_source
  $sudoers_content     = $seqdesk::sudoers_content
  $ssh_config_source   = $seqdesk::ssh_config_source
  $ssh_keys            = $seqdesk::ssh_keys

  $home = $user_home ? { undef => "/home/${user}", default => $user_home }

  if $bashrc_source != undef and $bashrc_source != '' {
    file { "${home}/.bashrc":
      ensure => file,
      owner  => $user,
      group  => $group,
      mode   => '0644',
      source => $bashrc_source,
    }
  }

  if $bash_profile_source != undef and $bash_profile_source != '' {
    file { "${home}/.bash_profile":
      ensure => file,
      owner  => $user,
      group  => $group,
      mode   => '0644',
      source => $bash_profile_source,
    }
  }

  if $puppet_conf_path != undef and $puppet_conf_path != '' {
    if $puppet_conf_source != undef and $puppet_conf_source != '' {
      file { $puppet_conf_path:
        ensure => file,
        owner  => $user,
        group  => $group,
        mode   => '0644',
        source => $puppet_conf_source,
      }
    } elsif $puppet_conf_content != undef and $puppet_conf_content != '' {
      file { $puppet_conf_path:
        ensure  => file,
        owner   => $user,
        group   => $group,
        mode    => '0644',
        content => $puppet_conf_content,
      }
    }
  }

  if $sudoers_path != undef and $sudoers_path != '' {
    if $sudoers_source != undef and $sudoers_source != '' {
      file { $sudoers_path:
        ensure => file,
        owner  => 'root',
        group  => 'root',
        mode   => '0600',
        source => $sudoers_source,
      }
    } elsif $sudoers_content != undef and $sudoers_content != '' {
      file { $sudoers_path:
        ensure  => file,
        owner   => 'root',
        group   => 'root',
        mode    => '0600',
        content => $sudoers_content,
      }
    }
  }

  # SSH: .ssh directory, config, and key pairs
  if $ssh_config_source != undef and $ssh_config_source != '' or !empty($ssh_keys) {
    file { "${home}/.ssh":
      ensure => directory,
      owner  => $user,
      group  => $group,
      mode   => '0700',
    }

    if $ssh_config_source != undef and $ssh_config_source != '' {
      file { "${home}/.ssh/config":
        ensure => file,
        owner  => $user,
        group  => $group,
        mode   => '0644',
        source => $ssh_config_source,
        require => File["${home}/.ssh"],
      }
    }

    $ssh_keys.each |Hash $key_entry| {
      $key_path = $key_entry['path']
      $priv_src = $key_entry['private_source']
      $pub_src  = $key_entry['public_source']
      if $key_path != undef and $key_path != '' and $priv_src != undef and $priv_src != '' {
        file { "${home}/.ssh/${key_path}":
          ensure  => file,
          owner   => $user,
          group   => $group,
          mode    => '0600',
          source  => $priv_src,
          require => File["${home}/.ssh"],
        }
        if $pub_src != undef and $pub_src != '' {
          file { "${home}/.ssh/${key_path}.pub":
            ensure  => file,
            owner   => $user,
            group   => $group,
            mode    => '0644',
            source  => $pub_src,
            require => File["${home}/.ssh"],
          }
        }
      }
    }
  }
}
