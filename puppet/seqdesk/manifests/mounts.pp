# @summary Optional: NFS (or other) mounts, e.g. for shared data paths
# Only included when seqdesk::mounts is non-empty. Each entry is a hash: path, device, fstype, options.
#
class seqdesk::mounts {
  $mounts = $seqdesk::mounts

  $mounts.each |Hash $m| {
    $path   = $m['path']
    $device = $m['device']
    $fstype = $m['fstype']
    $opts   = $m['options'] ? { undef => 'defaults', default => $m['options'] }

    file { $path:
      ensure => directory,
      mode   => '0755',
      before => Mount[$path],
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
