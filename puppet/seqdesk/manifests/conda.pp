# @summary Optional Conda/pipeline setup per installation.md (setup-conda-env.sh)
# Only included when seqdesk::with_pipelines is true.
# If $effective_conda_path does not exist, Miniconda is installed there (Linux x86_64 only).
#
class seqdesk::conda {
  $install_dir          = $seqdesk::install_dir
  $user                 = $seqdesk::user
  $group                = $seqdesk::group
  $effective_data_path  = $seqdesk::effective_data_path
  $effective_run_dir    = $seqdesk::effective_run_dir
  $effective_conda_path = $seqdesk::effective_conda_path

  $setup_script = "${install_dir}/scripts/setup-conda-env.sh"
  $conda_installer = '/tmp/Miniconda3-latest-Linux-x86_64.sh'

  # Install Miniconda if not present (installation.md - Install Miniconda)
  exec { 'seqdesk-download-miniconda':
    command => "/usr/bin/curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o ${conda_installer}",
    creates => $conda_installer,
  }
  exec { 'seqdesk-install-miniconda':
    command => "/bin/bash ${conda_installer} -b -p ${effective_conda_path}",
    creates => "${effective_conda_path}/bin/conda",
    require => Exec['seqdesk-download-miniconda'],
  }
  # So that $user can run conda and create envs
  exec { 'seqdesk-chown-conda':
    command => "/bin/chown -R ${user}:${group} ${effective_conda_path}",
    require => Exec['seqdesk-install-miniconda'],
    unless  => "/usr/bin/test $(stat -c %U ${effective_conda_path} 2>/dev/null) = ${user}",
  }

  # Run SeqDesk's setup-conda-env.sh (--yes --write-config --pipelines-enabled)
  exec { 'seqdesk-setup-conda-env':
    command     => "${setup_script} --yes --write-config --pipelines-enabled --data-path ${effective_data_path} --run-dir ${effective_run_dir} --conda-path ${effective_conda_path}",
    cwd         => $install_dir,
    user        => $user,
    environment => ["HOME=/tmp", "PATH=/usr/bin:${effective_conda_path}/bin:/bin"],
    require     => [Exec['seqdesk-prisma-seed'], File["${install_dir}/.env"], Exec['seqdesk-chown-conda']],
    unless      => "/usr/bin/test -f ${effective_conda_path}/envs/seqdesk-pipelines/bin/nextflow 2>/dev/null",
  }
}
