nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.profiles_dir = null
params.ground_truth = null
params.sample_map = '{}'
params.prediction_run_ids = ''
params.taxonomy_note = ''
params.taxonomy_confirmed = false
params.normalize = false

process OPAL {
  tag 'cami-benchmark'
  cpus 2
  memory '8 GB'
  conda 'bioconda::cami-opal=1.0.12 conda-forge::python=3.10'
  publishDir "${params.outdir}", mode: 'copy'

  input:
    path samplesheet, name: 'samplesheet.csv'
    path profiles, name: 'profiles'
    path ground_truth, name: 'reference.profile'
    path runner, name: 'runner.py'

  output:
    path 'opal', emit: report
    path 'benchmark.zip', emit: bundle
    path 'benchmark-provenance.json', emit: provenance

  script:
    def request = groovy.json.JsonOutput.toJson([
      input: samplesheet.toString(), profiles_dir: profiles.toString(), ground_truth: ground_truth.toString(),
      sample_map: params.sample_map, prediction_run_ids: params.prediction_run_ids,
      taxonomy_note: params.taxonomy_note,
      taxonomy_confirmed: params.taxonomy_confirmed.toString() == 'true',
      normalize: params.normalize.toString() == 'true'
    ]).bytes.encodeBase64().toString()
    """
    python3 runner.py '${request}'
    """
}

workflow {
  if (!params.input || !params.profiles_dir) error 'SeqDesk must provide a study samplesheet and staged completed profiles.'
  if (!params.ground_truth) error 'Configure a CAMI taxonomic Ground Truth profile first.'
  if (params.taxonomy_confirmed.toString() != 'true' || !params.taxonomy_note?.trim()) {
    error 'Confirm and document sample identity, taxonomy versions and abundance compatibility before benchmarking.'
  }
  OPAL(file(params.input, checkIfExists: true), file(params.profiles_dir, checkIfExists: true),
       file(params.ground_truth, checkIfExists: true), file("${projectDir}/bin/run_opal.py"))
}
