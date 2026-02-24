# @summary Optional: ensure a list of directories exist (e.g. /net/broker, /net/broker/env for NFS)
# Only included when seqdesk::ensure_directories is non-empty.
#
class seqdesk::directories {
  $ensure_directories = $seqdesk::ensure_directories
  $user               = $seqdesk::user
  $group              = $seqdesk::group

  $ensure_directories.each |String $dir_path| {
    file { $dir_path:
      ensure => directory,
      owner  => $user,
      group  => $group,
      mode   => '0755',
    }
  }
}
