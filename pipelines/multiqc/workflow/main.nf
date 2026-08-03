nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.report_title = 'Study MultiQC report'
// Directory holding copies of the declared QC artifacts from completed runs
// in the same study. SeqDesk creates this directory during run preparation.
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
    path "multiqc/multiqc_data/**", emit: data

  script:
    """
    mkdir -p multiqc

    # Never turn a missing/empty gather into a green but content-free report.
    # Nextflow stages a directory input as a symlink in the task work dir.
    # -H follows that command-line symlink without following any nested symlink
    # (the executor already rejects symlink artifacts while staging them).
    find -H "${qc_dir}" -type f -print -quit | grep -q . || {
      echo "No staged QC artifact files were found in ${qc_dir}" >&2
      exit 2
    }

    multiqc \\
      --force \\
      --no-ansi \\
      --title "${report_title}" \\
      --filename study-multiqc.html \\
      --outdir multiqc \\
      "${qc_dir}"

    # MultiQC derives the data-directory name from the report filename. Keep
    # SeqDesk's stable output contract independent of that display filename.
    test -d multiqc/study-multiqc_data
    mv multiqc/study-multiqc_data multiqc/multiqc_data
    test -s multiqc/multiqc_data/multiqc_data.json
    python -c 'import json,sys; data=json.load(open(sys.argv[1])); raw=data.get("report_saved_raw_data") or {}; fastqc=raw.get("multiqc_fastqc") or {}; nanostat=raw.get("multiqc_nanostat") or {}; assert (isinstance(fastqc,dict) and fastqc) or (isinstance(nanostat,dict) and nanostat), "MultiQC parsed no FastQC or NanoStat data from the staged inputs"' multiqc/multiqc_data/multiqc_data.json
    """
}

workflow {
  if (!params.input) {
    error "Missing --input samplesheet"
  }

  if (!params.qc_dir) {
    error "Missing --qc_dir. SeqDesk must stage prior QC artifacts before launch."
  }

  def qcDirPath = file(params.qc_dir)
  if (!qcDirPath.exists()) {
    error "Staged QC input directory does not exist: ${qcDirPath}"
  }

  MULTIQC(Channel.fromPath(qcDirPath, type: 'dir'), params.report_title)
}
