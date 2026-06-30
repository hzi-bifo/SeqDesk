nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.report_title = 'Study MultiQC report'
// Directory holding the gathered QC outputs of prior study runs.
// Defaults to a `qc_inputs` directory alongside the samplesheet; SeqDesk
// stages prior-run output dirs there before launch (see README "Gathering
// sibling runs"). If absent or empty, MultiQC still produces a report shell.
params.qc_dir = null

process MULTIQC {
  tag "study-multiqc"
  conda "bioconda::multiqc=1.21"

  publishDir "${params.outdir}", mode: 'copy', pattern: "multiqc/*"
  publishDir "${params.outdir}", mode: 'copy', pattern: "multiqc/multiqc_data/*"

  input:
    path qc_dir
    val report_title

  output:
    path "multiqc/study-multiqc.html", emit: report
    path "multiqc/multiqc_data/**", emit: data, optional: true

  script:
    """
    mkdir -p multiqc

    # MultiQC scans the gathered QC directory recursively. `--force` overwrites
    # any stale report, `--no-ansi` keeps logs clean for SeqDesk log capture.
    multiqc \\
      --force \\
      --no-ansi \\
      --title "${report_title}" \\
      --filename study-multiqc.html \\
      --outdir multiqc \\
      "${qc_dir}"
    """
}

workflow {
  if (!params.input) {
    error "Missing --input samplesheet"
  }

  // Resolve the gathered QC inputs directory. When SeqDesk has staged prior-run
  // outputs it sets params.qc_dir; otherwise fall back to a sibling `qc_inputs`
  // directory next to the samplesheet.
  def samplesheet = file(params.input)
  def qcDirPath = params.qc_dir ? file(params.qc_dir) : file("${samplesheet.parent}/qc_inputs")

  // MultiQC requires the scan target to exist. Materialize an empty directory
  // (with a placeholder) so the run still completes and yields a report shell
  // rather than failing when no prior QC outputs were gathered.
  if (!qcDirPath.exists()) {
    qcDirPath.mkdirs()
    file("${qcDirPath}/README.txt").text =
      "No prior QC outputs were gathered for this study run.\\n"
  }

  MULTIQC(Channel.fromPath(qcDirPath, type: 'dir'), params.report_title)
}
