nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.mode = 'shortReadPaired'
params.readCount = 1000
params.readLength = 150
params.replaceExisting = true

if (!params.input) {
  error "Missing --input samplesheet"
}

Channel
  .fromPath(params.input)
  .splitCsv(header: true)
  .map { row ->
    def sampleId = (row.sample_id ?: '').toString().trim()
    def orderId = (row.order_id ?: '').toString().trim()

    if (!sampleId || !orderId) {
      error "Each row must define sample_id and order_id"
    }

    tuple(sampleId, orderId)
  }
  .set { simulation_inputs }

process SIMULATE_READS {
  tag "${sample_id}"

  publishDir "${params.outdir}", mode: 'copy', pattern: "reads/*"
  publishDir "${params.outdir}", mode: 'copy', pattern: "manifests/*.json"
  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    tuple val(sample_id), val(order_id)

  output:
    path "reads/*", emit: reads
    path "manifests/${sample_id}.json", emit: manifests
    path "summary/${sample_id}.tsv", emit: summary_rows

  script:
    """
    mkdir -p reads manifests summary

    node "${projectDir}/../scripts/generate-reads.mjs" \\
      --sample-id "${sample_id}" \\
      --order-id "${order_id}" \\
      --mode "${params.mode}" \\
      --read-count "${params.readCount}" \\
      --read-length "${params.readLength}" \\
      --replace-existing "${params.replaceExisting}" \\
      --reads-dir "reads" \\
      --manifest-path "manifests/${sample_id}.json" \\
      --summary-path "summary/${sample_id}.tsv"
    """
}

process SUMMARIZE_SIMULATION {
  tag "simulation-summary"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path summary_rows

  output:
    path "summary/simulation-summary.tsv", emit: summary

  script:
    def inputFiles = summary_rows.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\tmode\\tfile1\\tfile2\\tchecksum1\\tchecksum2\\n" > summary/simulation-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/simulation-summary.tsv
    """
}

workflow {
  SIMULATE_READS(simulation_inputs)
  SUMMARIZE_SIMULATION(SIMULATE_READS.out.summary_rows.collect())
}
