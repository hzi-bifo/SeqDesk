# @summary Optional: manage user shell config (.bashrc, .bash_profile), puppet.conf, sudoers fragment, and SSH config/keys
# When bashrc_source or puppet_conf_source is 'seqdesk' or a puppet:///modules/seqdesk/... URI (e.g. bashrc.erb, puppet.conf), the module ERB templates are rendered. Otherwise use the given source/content (legacy broker-style).
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

  # Use seqdesk ERB template when source is 'seqdesk' or a puppet:///modules/seqdesk/ URI for bashrc (no file in module)
  $seqdesk_bashrc_uris = ['seqdesk', 'puppet:///modules/seqdesk/bashrc', 'puppet:///modules/seqdesk/bashrc.erb']
  $use_seqdesk_bashrc_template = $bashrc_source != undef and $bashrc_source != '' and $bashrc_source in $seqdesk_bashrc_uris
  $conda_path_for_bashrc = $seqdesk::with_pipelines ? {
    true    => ($seqdesk::conda_path ? { undef => '/opt/miniconda3', default => $seqdesk::conda_path }),
    default => undef,
  }

  if $use_seqdesk_bashrc_template {
    file { "${home}/.bashrc":
      ensure  => file,
      owner   => $user,
      group   => $group,
      mode    => '0644',
      content => template('seqdesk/bashrc.erb'),
    }
  } elsif $bashrc_source != undef and $bashrc_source != '' {
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

  # Use seqdesk ERB template when source is 'seqdesk' or puppet:///modules/seqdesk/puppet.conf[.erb], or path set with no source/content
  $seqdesk_puppet_conf_uris = ['seqdesk', 'puppet:///modules/seqdesk/puppet.conf', 'puppet:///modules/seqdesk/puppet.conf.erb']
  $use_seqdesk_puppet_conf_template = $puppet_conf_path != undef and $puppet_conf_path != '' and (
    $puppet_conf_source in $seqdesk_puppet_conf_uris or
    (($puppet_conf_source == undef or $puppet_conf_source == '') and ($puppet_conf_content == undef or $puppet_conf_content == ''))
  )

  if $puppet_conf_path != undef and $puppet_conf_path != '' {
    if $use_seqdesk_puppet_conf_template {
      file { $puppet_conf_path:
        ensure  => file,
        owner   => $user,
        group   => $group,
        mode    => '0644',
        content => template('seqdesk/puppet.conf.erb'),
      }
    } elsif $puppet_conf_source != undef and $puppet_conf_source != '' {
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
      $key_path      = $key_entry['path']
      $priv_src      = $key_entry['private_source']
      $priv_lookup   = $key_entry['private_lookup']
      $pub_src       = $key_entry['public_source']
      $has_private   = $key_path != undef and $key_path != '' and ($priv_src != undef and $priv_src != '' or $priv_lookup != undef and $priv_lookup != '')
      if $has_private {
        if $priv_lookup != undef and $priv_lookup != '' {
          file { "${home}/.ssh/${key_path}":
            ensure  => file,
            owner   => $user,
            group   => $group,
            mode    => '0600',
            content => lookup($priv_lookup),
            require => File["${home}/.ssh"],
          }
        } else {
          file { "${home}/.ssh/${key_path}":
            ensure  => file,
            owner   => $user,
            group   => $group,
            mode    => '0600',
            source  => $priv_src,
            require => File["${home}/.ssh"],
          }
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
