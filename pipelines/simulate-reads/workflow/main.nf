nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.simulationMode = 'auto'
params.mode = 'shortReadPaired'
params.readCount = 1000
params.readLength = 150
params.replaceExisting = true
params.qualityProfile = 'standard'
params.insertMean = 350
params.insertStdDev = 30
params.seed = null
params.templateDir = ''
params.dataBasePath = null

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
    def seedArg = params.seed != null && params.seed.toString().trim()
      ? "--seed \"${params.seed}\" \\\n"
      : ""
    def templateDirArg = params.templateDir != null && params.templateDir.toString().trim()
      ? "--template-dir \"${params.templateDir}\" \\\n"
      : ""
    def dataBasePathArg = params.dataBasePath != null && params.dataBasePath.toString().trim()
      ? "--data-base-path \"${params.dataBasePath}\" \\\n"
      : ""
    def optionalArgs = [seedArg, templateDirArg, dataBasePathArg].findAll { it }.join('')
    """
    mkdir -p reads manifests summary

    node "${projectDir}/../scripts/generate-reads.mjs" \\
      --sample-id "${sample_id}" \\
      --order-id "${order_id}" \\
      --simulation-mode "${params.simulationMode}" \\
      --mode "${params.mode}" \\
      --read-count "${params.readCount}" \\
      --read-length "${params.readLength}" \\
      --replace-existing "${params.replaceExisting}" \\
      --quality-profile "${params.qualityProfile}" \\
      --insert-mean "${params.insertMean}" \\
      --insert-std-dev "${params.insertStdDev}" \\
      ${optionalArgs}\
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
    printf "sample_id\\tmode\\tsimulation_mode_requested\\tsimulation_mode_used\\tquality_profile\\tinsert_mean\\tinsert_std_dev\\tseed\\ttemplate_label\\ttemplate_dir\\tfile1\\tfile2\\tchecksum1\\tchecksum2\\tread_count1\\tread_count2\\tread_length\\n" > summary/simulation-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/simulation-summary.tsv
    """
}

workflow {
  SIMULATE_READS(simulation_inputs)
  SUMMARIZE_SIMULATION(SIMULATE_READS.out.summary_rows.collect())
}
