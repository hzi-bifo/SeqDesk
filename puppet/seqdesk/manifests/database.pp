# @summary Initialize database: prisma db push and prisma db seed (installation.md step 5)
#
class seqdesk::database {
  $install_dir = $seqdesk::install_dir
  $user        = $seqdesk::user

  $prisma = "${install_dir}/node_modules/.bin/prisma"

  exec { 'seqdesk-prisma-push':
    command     => "${prisma} db push",
    cwd         => $install_dir,
    user        => $user,
    environment => ['HOME=/tmp'],
    require     => [Exec['seqdesk-npm-install-once'], File["${install_dir}/.env"]],
  }

  exec { 'seqdesk-prisma-seed':
    command     => "${prisma} db seed",
    cwd         => $install_dir,
    user        => $user,
    environment => ['HOME=/tmp'],
    require     => Exec['seqdesk-prisma-push'],
  }
}
