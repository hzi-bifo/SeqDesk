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

    # NanoPlot 1.42 keeps the .txt filename with --tsv_stats, but NanoMath
    # writes an exact two-column TSV with machine keys such as
    # number_of_reads and mean_qual. Parse that contract fail-closed: missing,
    # duplicate, malformed, or wrongly formatted required metrics must fail
    # the task rather than silently becoming zero.
    STATS="nanoplot/${sample_id}_NanoStats.txt"
    build_nanoplot_summary.py "\$STATS" "${sample_id}" > "per_sample/${sample_id}.tsv"
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
