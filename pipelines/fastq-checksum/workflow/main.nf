nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'

if (!params.input) {
  error "Missing --input samplesheet"
}

Channel
  .fromPath(params.input)
  .splitCsv(header: true)
  .map { row ->
    def sampleId = (row.sample_id ?: '').toString()
    def fastq1 = (row.fastq_1 ?: '').toString()
    def fastq2 = (row.fastq_2 ?: '').toString()

    if (!sampleId || !fastq1) {
      error "Each row must define sample_id and fastq_1"
    }

    tuple(sampleId, fastq1, fastq2)
  }
  .set { checksum_inputs }

process CALCULATE_CHECKSUMS {
  tag "${sample_id}"

  publishDir "${params.outdir}", mode: 'copy', pattern: "checksums/*.json"
  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    tuple val(sample_id), val(fastq_1), val(fastq_2)

  output:
    path "checksums/${sample_id}.json", emit: checksum_json
    path "summary/${sample_id}.tsv", emit: checksum_tsv

  script:
    def fastq2Value = fastq_2?.trim() ?: ''
    """
    mkdir -p checksums summary

    MD5_1=\$(md5sum "${fastq_1}" | awk '{print \$1}')
    MD5_2=""

    if [ -n "${fastq2Value}" ]; then
      MD5_2=\$(md5sum "${fastq_2}" | awk '{print \$1}')
    fi

    cat > "checksums/${sample_id}.json" <<JSON
    {"sampleId":"${sample_id}","checksum1":"\$MD5_1","checksum2":"\${MD5_2}"}
JSON

    {
      printf "sample_id\\tchecksum1\\tchecksum2\\n"
      printf "%s\\t%s\\t%s\\n" "${sample_id}" "\$MD5_1" "\$MD5_2"
    } > "summary/${sample_id}.tsv"
    """
}

process SUMMARIZE_CHECKSUMS {
  tag "checksum-summary"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path checksum_rows

  output:
    path "summary/checksum-summary.tsv", emit: summary

  script:
    def inputFiles = checksum_rows.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\tchecksum1\\tchecksum2\\n" > summary/checksum-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/checksum-summary.tsv
    """
}

workflow {
  CALCULATE_CHECKSUMS(checksum_inputs)
  SUMMARIZE_CHECKSUMS(CALCULATE_CHECKSUMS.out.checksum_tsv.collect())
}
