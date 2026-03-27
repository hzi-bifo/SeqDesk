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
  .set { reads_input }

process SEQKIT_STATS {
  tag "${sample_id}"
  conda "bioconda::seqkit=2.8.0"

  publishDir "${params.outdir}", mode: 'copy', pattern: "per_sample/*.tsv"

  input:
    tuple val(sample_id), val(fastq_1), val(fastq_2)

  output:
    path "per_sample/${sample_id}.tsv", emit: stats

  script:
    def fastq2Value = fastq_2?.trim() ?: ''
    """
    mkdir -p per_sample

    compute_stats() {
      local FILE="\$1"
      local LABEL="\$2"

      # Extract fields by header name so newer seqkit releases can add columns
      # (for example N50_num) without shifting the values we write downstream.
      PARSED_STATS=\$(seqkit stats -a -T "\$FILE" | awk -f "${projectDir}/bin/extract_seqkit_stats.awk")

      NUM_READS=\$(echo "\$PARSED_STATS" | cut -f1)
      TOTAL_BASES=\$(echo "\$PARSED_STATS" | cut -f2)
      MIN_LEN=\$(echo "\$PARSED_STATS" | cut -f3)
      AVG_LEN=\$(echo "\$PARSED_STATS" | cut -f4)
      MAX_LEN=\$(echo "\$PARSED_STATS" | cut -f5)
      N50=\$(echo "\$PARSED_STATS" | cut -f6)
      Q20_PCT=\$(echo "\$PARSED_STATS" | cut -f7)
      Q30_PCT=\$(echo "\$PARSED_STATS" | cut -f8)
      AVG_QUAL=\$(echo "\$PARSED_STATS" | cut -f9)

      # Compute GC content using seqkit fx2tab
      GC=\$(seqkit fx2tab -g -H "\$FILE" | awk 'NR>1 {sum+=\$NF; n++} END {if(n>0) printf "%.2f", sum/n; else print "0"}')

      printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\
        "${sample_id}" "\$LABEL" "\$NUM_READS" "\$TOTAL_BASES" "\$MIN_LEN" "\$AVG_LEN" "\$MAX_LEN" "\$AVG_QUAL" "\$GC" "\$Q20_PCT" "\$Q30_PCT" "\$N50"
    }

    {
      printf "sample_id\\tread_end\\tnum_reads\\ttotal_bases\\tmin_len\\tavg_len\\tmax_len\\tavg_quality\\tgc_content\\tq20_pct\\tq30_pct\\tn50\\n"
      compute_stats "${fastq_1}" "R1"
      if [ -n "${fastq2Value}" ]; then
        compute_stats "${fastq_2}" "R2"
      fi
    } > "per_sample/${sample_id}.tsv"
    """
}

process COLLECT_STATS {
  tag "collect"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path sample_tsvs

  output:
    path "summary/reads-qc-summary.tsv", emit: summary

  script:
    def inputFiles = sample_tsvs.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\tread_end\\tnum_reads\\ttotal_bases\\tmin_len\\tavg_len\\tmax_len\\tavg_quality\\tgc_content\\tq20_pct\\tq30_pct\\tn50\\n" > summary/reads-qc-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/reads-qc-summary.tsv
    """
}

process GENERATE_REPORT {
  tag "report"
  conda "conda-forge::python>=3.9"

  publishDir "${params.outdir}", mode: 'copy', pattern: "report/*.html"

  input:
    path summary_tsv

  output:
    path "report/reads-qc-report.html", emit: report

  script:
    """
    mkdir -p report
    generate_report.py "${summary_tsv}" report/reads-qc-report.html
    """
}

workflow {
  SEQKIT_STATS(reads_input)
  COLLECT_STATS(SEQKIT_STATS.out.stats.collect())
  GENERATE_REPORT(COLLECT_STATS.out.summary)
}
