nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'

process NANOPLOT {
  tag "${sample_id}"
  conda "bioconda::nanoplot=1.42.0"

  publishDir "${params.outdir}", mode: 'copy', pattern: "nanoplot/*"
  publishDir "${params.outdir}", mode: 'copy', pattern: "per_sample/*.tsv"

  input:
    tuple val(sample_id), val(fastq)

  output:
    path "nanoplot/${sample_id}_NanoPlot-report.html", emit: report
    path "nanoplot/${sample_id}_NanoStats.txt", emit: stats
    path "per_sample/${sample_id}.tsv", emit: row

  script:
    """
    mkdir -p nanoplot per_sample

    NanoPlot \\
      --fastq "${fastq}" \\
      --prefix "${sample_id}_" \\
      --outdir nanoplot \\
      --tsv_stats \\
      --N50 \\
      --no_static

    # NanoStats.txt is the human-readable "key:value" summary NanoPlot writes.
    # Pull the metrics we care about by label so column order changes upstream
    # do not silently break the summary row.
    STATS="nanoplot/${sample_id}_NanoStats.txt"

    extract() {
      # \$1 = label prefix to match at start of line
      awk -F'\\t' -v key="\$1" '
        index(\$1, key) == 1 {
          gsub(/,/, "", \$2);
          gsub(/[^0-9.]/, "", \$2);
          print \$2;
          exit
        }
      ' "\$STATS"
    }

    NUM_READS=\$(extract "Number of reads")
    TOTAL_BASES=\$(extract "Total bases")
    MEAN_LEN=\$(extract "Mean read length")
    MEDIAN_LEN=\$(extract "Median read length")
    READ_N50=\$(extract "Read length N50")
    MEAN_QUAL=\$(extract "Mean read quality")

    : "\${NUM_READS:=0}"
    : "\${TOTAL_BASES:=0}"
    : "\${MEAN_LEN:=0}"
    : "\${MEDIAN_LEN:=0}"
    : "\${READ_N50:=0}"
    : "\${MEAN_QUAL:=0}"

    {
      printf "sample_id\\tnum_reads\\ttotal_bases\\tmean_length\\tmedian_length\\tread_n50\\tmean_quality\\n"
      printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\
        "${sample_id}" "\$NUM_READS" "\$TOTAL_BASES" "\$MEAN_LEN" "\$MEDIAN_LEN" "\$READ_N50" "\$MEAN_QUAL"
    } > "per_sample/${sample_id}.tsv"
    """
}

process COLLECT_STATS {
  tag "collect"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path sample_tsvs

  output:
    path "summary/nanoplot-summary.tsv", emit: summary

  script:
    def inputFiles = sample_tsvs.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\tnum_reads\\ttotal_bases\\tmean_length\\tmedian_length\\tread_n50\\tmean_quality\\n" > summary/nanoplot-summary.tsv
    awk 'FNR > 1 { print }' ${inputFiles} >> summary/nanoplot-summary.tsv
    """
}

workflow {
  if (!params.input) {
    error "Missing --input samplesheet"
  }

  reads_input = Channel
    .fromPath(params.input)
    .splitCsv(header: true)
    .map { row ->
      def sampleId = (row.sample_id ?: '').toString()
      def fastq = (row.fastq ?: '').toString()

      if (!sampleId || !fastq) {
        error "Each row must define sample_id and fastq"
      }

      tuple(sampleId, fastq)
    }

  NANOPLOT(reads_input)
  COLLECT_STATS(NANOPLOT.out.row.collect())
}
