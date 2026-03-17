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
  .set { fastqc_inputs }

process RUN_FASTQC {
  tag "${sample_id}"
  conda "bioconda::fastqc=0.12.1"

  publishDir "${params.outdir}", mode: 'copy', pattern: "fastqc_reports/*.html"
  publishDir "${params.outdir}", mode: 'copy', pattern: "fastqc_reports/*.zip"
  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    tuple val(sample_id), val(fastq_1), val(fastq_2)

  output:
    path "fastqc_reports/${sample_id}*_fastqc.html", emit: html_reports
    path "fastqc_reports/${sample_id}*_fastqc.zip", emit: zip_reports
    path "summary/${sample_id}.tsv", emit: summary_row

  script:
    def fastq2Value = fastq_2?.trim() ?: ''
    """
    mkdir -p fastqc_raw fastqc_reports summary

    # Run FastQC on R1
    fastqc --outdir fastqc_raw --threads 1 "${fastq_1}"

    # Rename outputs to use sample_id prefix
    R1_BASE=\$(basename "${fastq_1}" | sed 's/\\.fastq\\.gz\$//' | sed 's/\\.fastq\$//' | sed 's/\\.fq\\.gz\$//' | sed 's/\\.fq\$//')
    mv "fastqc_raw/\${R1_BASE}_fastqc.html" "fastqc_reports/${sample_id}_R1_fastqc.html"
    mv "fastqc_raw/\${R1_BASE}_fastqc.zip" "fastqc_reports/${sample_id}_R1_fastqc.zip"

    # Extract summary for R1
    unzip -p "fastqc_reports/${sample_id}_R1_fastqc.zip" "*/summary.txt" > fastqc_raw/r1_summary.txt

    # Handle R2 if present
    R2_STATUS=""
    if [ -n "${fastq2Value}" ]; then
      fastqc --outdir fastqc_raw --threads 1 "${fastq_2}"
      R2_BASE=\$(basename "${fastq_2}" | sed 's/\\.fastq\\.gz\$//' | sed 's/\\.fastq\$//' | sed 's/\\.fq\\.gz\$//' | sed 's/\\.fq\$//')
      mv "fastqc_raw/\${R2_BASE}_fastqc.html" "fastqc_reports/${sample_id}_R2_fastqc.html"
      mv "fastqc_raw/\${R2_BASE}_fastqc.zip" "fastqc_reports/${sample_id}_R2_fastqc.zip"
      unzip -p "fastqc_reports/${sample_id}_R2_fastqc.zip" "*/summary.txt" > fastqc_raw/r2_summary.txt
    fi

    # Build per-sample summary row
    # Count PASS/WARN/FAIL from R1 summary
    R1_PASS=\$(grep -c "^PASS" fastqc_raw/r1_summary.txt || true)
    R1_WARN=\$(grep -c "^WARN" fastqc_raw/r1_summary.txt || true)
    R1_FAIL=\$(grep -c "^FAIL" fastqc_raw/r1_summary.txt || true)

    R2_PASS=""
    R2_WARN=""
    R2_FAIL=""
    if [ -f fastqc_raw/r2_summary.txt ]; then
      R2_PASS=\$(grep -c "^PASS" fastqc_raw/r2_summary.txt || true)
      R2_WARN=\$(grep -c "^WARN" fastqc_raw/r2_summary.txt || true)
      R2_FAIL=\$(grep -c "^FAIL" fastqc_raw/r2_summary.txt || true)
    fi

    {
      printf "sample_id\\tr1_pass\\tr1_warn\\tr1_fail\\tr2_pass\\tr2_warn\\tr2_fail\\n"
      printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\
        "${sample_id}" "\$R1_PASS" "\$R1_WARN" "\$R1_FAIL" "\$R2_PASS" "\$R2_WARN" "\$R2_FAIL"
    } > "summary/${sample_id}.tsv"
    """
}

process SUMMARIZE_FASTQC {
  tag "fastqc-summary"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path summary_rows

  output:
    path "summary/fastqc-summary.tsv", emit: summary

  script:
    def inputFiles = summary_rows.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\tr1_pass\\tr1_warn\\tr1_fail\\tr2_pass\\tr2_warn\\tr2_fail\\n" > summary/fastqc-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/fastqc-summary.tsv
    """
}

workflow {
  RUN_FASTQC(fastqc_inputs)
  SUMMARIZE_FASTQC(RUN_FASTQC.out.summary_row.collect())
}
