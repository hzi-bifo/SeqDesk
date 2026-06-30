nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.kraken2_db = null
params.confidence = 0.0
params.bracken_read_length = 150
params.bracken_level = 'S'
params.krona = true

process KRAKEN2_KRAKEN2 {
  tag "${sample_id}"
  conda "bioconda::kraken2=2.1.3"

  // Kraken2 loads the whole DB into RAM (a Standard DB is ~12 GB). Run one classification
  // at a time and reserve enough memory so the local/SLURM executor never over-schedules
  // and OOMs the node.
  cpus 8
  memory '16 GB'
  maxForks 1

  publishDir "${params.outdir}", mode: 'copy', pattern: "kraken2/*"

  input:
    tuple val(sample_id), val(fastq_1), val(fastq_2)

  output:
    tuple val(sample_id), path("kraken2/${sample_id}.kraken2.report.txt"), emit: report

  script:
    def paired = fastq_2?.trim() ? true : false
    def pairedFlag = paired ? '--paired' : ''
    def reads = paired ? "\"${fastq_1}\" \"${fastq_2}\"" : "\"${fastq_1}\""
    """
    mkdir -p kraken2
    kraken2 \\
      --db "${params.kraken2_db}" \\
      --threads ${task.cpus} \\
      --confidence ${params.confidence} \\
      ${pairedFlag} \\
      --report "kraken2/${sample_id}.kraken2.report.txt" \\
      --output "kraken2/${sample_id}.kraken2.output.txt" \\
      ${reads}
    """
}

process BRACKEN_BRACKEN {
  tag "${sample_id}"
  conda "bioconda::bracken=2.9"

  publishDir "${params.outdir}", mode: 'copy', pattern: "bracken/*"

  input:
    tuple val(sample_id), path(kraken2_report)

  output:
    tuple val(sample_id), path("bracken/${sample_id}.bracken.tsv"), emit: abundance
    tuple val(sample_id), path("bracken/${sample_id}.bracken.report.txt"), emit: report

  script:
    """
    mkdir -p bracken
    bracken \\
      -d "${params.kraken2_db}" \\
      -i "${kraken2_report}" \\
      -o "bracken/${sample_id}.bracken.raw.tsv" \\
      -w "bracken/${sample_id}.bracken.report.txt" \\
      -r ${params.bracken_read_length} \\
      -l ${params.bracken_level}

    # Prepend a sample_id column so SeqDesk can match rows to samples.
    awk -v sid="${sample_id}" 'BEGIN{FS=OFS="\\t"}
      NR==1 { print "sample_id", \$0; next }
      { print sid, \$0 }' \\
      "bracken/${sample_id}.bracken.raw.tsv" \\
      | sort -t \$'\\t' -k8,8gr > "bracken/${sample_id}.bracken.tsv"
    """
}

process KRONA {
  tag "${sample_id}"
  conda "bioconda::krakentools=1.2 bioconda::krona=2.8.1"

  publishDir "${params.outdir}", mode: 'copy', pattern: "krona/*"

  input:
    tuple val(sample_id), path(bracken_report)

  output:
    path "krona/${sample_id}.krona.html", emit: html

  when:
    params.krona

  script:
    """
    mkdir -p krona
    kreport2krona.py -r "${bracken_report}" -o "${sample_id}.krona.txt"
    ktImportText "${sample_id}.krona.txt" -o "krona/${sample_id}.krona.html"
    """
}

process COLLECT_SUMMARY {
  tag "summary"

  publishDir "${params.outdir}", mode: 'copy', pattern: "summary/*.tsv"

  input:
    path bracken_tsvs

  output:
    path "summary/kraken2-bracken-summary.tsv", emit: summary

  script:
    def inputFiles = bracken_tsvs.collect { "\"${it}\"" }.join(' ')
    """
    mkdir -p summary
    printf "sample_id\\ttop_taxon\\ttaxonomy_id\\ttaxonomy_lvl\\tnew_est_reads\\tfraction_total_reads\\n" > summary/kraken2-bracken-summary.tsv
    for f in ${inputFiles}; do
      # First data row of each per-sample table is the most abundant taxon
      # (tables are sorted by fraction_total_reads descending).
      awk 'BEGIN{FS=OFS="\\t"} FNR==2 { print \$1, \$2, \$3, \$4, \$7, \$8 }' "\$f" >> summary/kraken2-bracken-summary.tsv
    done
    """
}

workflow {
  if (!params.input) {
    error "Missing --input samplesheet"
  }
  if (!params.kraken2_db) {
    error "Missing --kraken2_db database path"
  }

  reads_input = Channel
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

  KRAKEN2_KRAKEN2(reads_input)
  BRACKEN_BRACKEN(KRAKEN2_KRAKEN2.out.report)
  KRONA(BRACKEN_BRACKEN.out.report)
  COLLECT_SUMMARY(BRACKEN_BRACKEN.out.abundance.map { it[1] }.collect())
}
