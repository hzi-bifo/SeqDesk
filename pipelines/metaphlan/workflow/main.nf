nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.db_dir = null
params.db_index = null
params.skip_unclassified_estimation = false

process METAPHLAN {
  tag sample_id
  cpus 4
  memory '16 GB'
  maxForks 1
  conda 'bioconda::metaphlan=4.2.5'
  publishDir "${params.outdir}/profiles", mode: 'copy'

  input:
    tuple val(sample_id), path(reads, stageAs: 'reads/*')
    path runner, name: 'runner.py'

  output:
    path "${sample_id}.metaphlan.tsv", emit: native_profile
    path "${sample_id}.cami.profile", emit: cami_profile
    path "${sample_id}.provenance.json", emit: provenance

  script:
    // Only a base64 JSON envelope enters the shell, never sample names or paths.
    def stagedReads = reads instanceof List ? reads : [reads]
    def request = groovy.json.JsonOutput.toJson([
      sample_id: sample_id, reads: stagedReads.collect { it.toString() },
      db_dir: params.db_dir, db_index: params.db_index, cpus: task.cpus,
      skip_unclassified_estimation: params.skip_unclassified_estimation.toString() == 'true'
    ]).bytes.encodeBase64().toString()
    """
    python3 runner.py '${request}'
    """
}

workflow {
  if (!params.input) error 'Missing --input samplesheet'
  if (!params.db_dir || !params.db_index || params.db_index == 'latest') {
    error 'Configure an installed MetaPhlAn database directory and exact index first; no automatic downloads.'
  }
  def seen = new HashSet()
  def samples = Channel.fromPath(params.input, checkIfExists: true).splitCsv(header: true).map { row ->
    def id = row.sample_id?.trim()
    if (!id || !(id ==~ /[A-Za-z0-9][A-Za-z0-9._-]{0,119}/) || !seen.add(id)) {
      error 'Sample codes must be unique, path-safe identifiers (maximum 120 characters).'
    }
    if (!row.fastq_1) error "Missing FASTQ input for ${id}"
    def reads = [file(row.fastq_1, checkIfExists: true)]
    if (row.fastq_2?.trim()) reads.add(file(row.fastq_2, checkIfExists: true))
    // Avoid colliding stage names when pairs were stored in separate directories.
    if (reads*.name.toSet().size() != reads.size()) error "Read filenames must differ for ${id}"
    tuple(id, reads)
  }
  METAPHLAN(samples, file("${projectDir}/bin/run_metaphlan.py"))
}
