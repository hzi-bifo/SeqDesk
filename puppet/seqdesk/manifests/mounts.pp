# @summary Optional: NFS (or other) mounts, e.g. for shared data paths
# Only included when seqdesk::mounts is non-empty. Each entry is a hash: path, device, fstype, options.
# Set manage_mount_point_dirs false if the mount point directory is created elsewhere (e.g. ensure_directories).
#
class seqdesk::mounts {
  $mounts                  = $seqdesk::mounts
  $manage_mount_point_dirs = $seqdesk::manage_mount_point_dirs

  $mounts.each |Hash $m| {
    $path   = $m['path']
    $device = $m['device']
    $fstype = $m['fstype']
    $opts   = $m['options'] ? { undef => 'defaults', default => $m['options'] }

    if $manage_mount_point_dirs {
      file { $path:
        ensure => directory,
        mode   => '0755',
        before => Mount[$path],
      }
    }

    mount { $path:
      ensure  => mounted,
      device  => $device,
      fstype  => $fstype,
      options => $opts,
      atboot  => true,
    }
  }
}
