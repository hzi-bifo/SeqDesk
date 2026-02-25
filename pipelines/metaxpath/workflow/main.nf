nextflow.enable.dsl = 2

def requireParam = { String key ->
  def value = params[key]
  if (value == null || value.toString().trim().isEmpty()) {
    error "Missing required parameter --${key}"
  }
}

requireParam('input')
requireParam('outdir')
requireParam('metax_db')
requireParam('metax_dmp_dir')
requireParam('kraken2_db')
requireParam('sylph_db')

params.run_date = params.run_date ?: new Date().format('yyyyMMdd')
def runOutDir = "${params.outdir}/run_${params.run_date}"

def supportedSequencers = ['Nanopore', 'PacBio'] as Set
def allowedAssemblers = ['flye', 'myloasm', 'strainberry'] as Set
def assemblerList = (params.assemblers ?: 'flye')
  .toString()
  .split(',')
  .collect { it.trim() }
  .findAll { !it.isEmpty() }

if (assemblerList.isEmpty()) {
  error "No assemblers provided. Use --assemblers flye,myloasm"
}

def invalidAssemblers = assemblerList.findAll { !allowedAssemblers.contains(it) }
if (invalidAssemblers) {
  error "Unsupported assembler(s): ${invalidAssemblers.join(', ')}. Allowed: ${allowedAssemblers.join(', ')}"
}

process INPUT_CHECK {
  tag "samplesheet"

  input:
  path samplesheet

  output:
  path "samplesheet.validated.csv"

  script:
  """
  python - <<'PY'
import csv
import os
import sys

required = {"sample", "long_reads"}
path = "${samplesheet}"

with open(path, newline="", encoding="utf-8") as fh:
    reader = csv.DictReader(fh)
    headers = set(reader.fieldnames or [])
    missing = sorted(required - headers)
    if missing:
        sys.stderr.write("Missing required samplesheet columns: " + ",".join(missing) + "\\n")
        sys.exit(1)

    seen = set()
    row_num = 1
    for row in reader:
        row_num += 1
        sample = (row.get("sample") or "").strip()
        reads = (row.get("long_reads") or "").strip()
        if not sample:
            sys.stderr.write(f"Row {row_num}: empty sample value\\n")
            sys.exit(1)
        if sample in seen:
            sys.stderr.write(f"Duplicate sample name in samplesheet: {sample}\\n")
            sys.exit(1)
        seen.add(sample)
        if not reads:
            sys.stderr.write(f"Row {row_num}: empty long_reads value\\n")
            sys.exit(1)
        if not os.path.exists(reads):
            sys.stderr.write(f"Row {row_num}: long_reads path not found: {reads}\\n")
            sys.exit(1)
PY
  cp "${samplesheet}" samplesheet.validated.csv
  """
}

process MV_FASTQ {
  tag { sample }
  publishDir "${runOutDir}/qc/nohuman", mode: 'copy', overwrite: true

  input:
  tuple val(sample), path(long_reads), val(sequencer)

  output:
  tuple val(sample), path("${sample}.nohuman.fq.gz"), path("${sample}.nohuman_fract.stats"), val(sequencer)

  script:
  """
  if [[ "${long_reads}" == *.gz ]]; then
    ln -sf "${long_reads}" "${sample}.nohuman.fq.gz"
    total_lines=\$(zcat "${long_reads}" | wc -l | tr -d ' ')
  else
    gzip -c "${long_reads}" > "${sample}.nohuman.fq.gz"
    total_lines=\$(wc -l < "${long_reads}" | tr -d ' ')
  fi

  if [[ -z "\$total_lines" ]]; then
    total_lines=0
  fi

  total_reads=\$((total_lines / 4))
  echo -e "\${total_reads}\\t\${total_reads}" > "${sample}.nohuman_fract.stats"
  """
}

process METAX_PROFILE {
  tag { sample }
  publishDir "${runOutDir}/profiling/metax", mode: 'copy', overwrite: true

  input:
  tuple val(sample), path(nohuman_fastq), path(nohuman_stats), val(sequencer)

  output:
  tuple val(sample), path("${sample}.metax.sam"), path("${sample}.metax.profile.txt"), val(sequencer)

  script:
  """
  seq_type="${sequencer}"
  if [[ -z "\${seq_type}" || "\${seq_type}" == "null" ]]; then
    seq_type="${params.sequencer}"
  fi

  metax profile \\
    --db "${params.metax_db}.json" \\
    --dmp-dir "${params.metax_dmp_dir}" \\
    -i "${nohuman_fastq}" \\
    -o "${sample}.metax" \\
    -t ${task.cpus} \\
    --sequencer "\${seq_type}" \\
    --mode recall \\
    -r "-b 0 --chunk-breadth 0 --identity 0.92" \\
    -- "-s SMEMs --Maximal_Ambiguity 200 --SoC_Score_Drop-off 0.05 --Seeding_Drop-off_B_-_Factor 0.0025"
  """
}

process SAM2BAM {
  tag { sample }
  publishDir "${runOutDir}/profiling/metax", mode: 'copy', overwrite: true

  input:
  tuple val(sample), path(metax_sam), path(metax_profile), val(sequencer)

  output:
  tuple val(sample), path("${sample}.metax.bam"), path("${sample}.metax.profile.txt"), val(sequencer)

  script:
  """
  samtools view -@ ${task.cpus} -bS "${metax_sam}" > "${sample}.metax.bam"
  cp "${metax_profile}" "${sample}.metax.profile.txt"
  """
}

process SYLPH_PROFILE {
  tag { sample }
  publishDir "${runOutDir}/profiling/sylph", mode: 'copy', overwrite: true

  when:
  !params.skip_sylph

  input:
  tuple val(sample), path(nohuman_fastq), path(nohuman_stats), val(sequencer)

  output:
  tuple val(sample), path("${sample}.sylph.profile.txt")

  script:
  """
  total_lines=\$(zcat "${nohuman_fastq}" | wc -l | tr -d ' ')
  if [[ "\$total_lines" -ge 4 ]]; then
    sylph sketch -r "${nohuman_fastq}" -d . -S "${sample}"
    sylph profile -t ${task.cpus} "${params.sylph_db}" "${sample}.sylsp" \\
      -o "${sample}.sylph.profile.txt" -u --read-seq-id 90 -m 90
  else
    echo -e "Sample\\tTaxID\\tAbundance" > "${sample}.sylph.profile.txt"
  fi
  """
}

process PROCESS_METAX {
  tag { sample }
  publishDir "${runOutDir}/profiling/metax", mode: 'copy', overwrite: true

  input:
  tuple val(sample), path(metax_profile), val(sequencer)

  output:
  tuple val(sample), path("${sample}.metax.processed.profile.txt"), path("${sample}.metax.processed.filtered.profile.txt"), val(sequencer)

  script:
  """
  python "${projectDir}/scripts/process_metax.py" \\
    --new \\
    --humanvirus "${params.humanvirus}" \\
    --contamination "${params.contamination_table}" \\
    "${metax_profile}" "${sample}.metax.processed"
  """
}

process PRED_VFS_AMRS {
  tag { "${sample}:${assembler}" }
  publishDir runOutDir, mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(sample), path(nohuman_fastq), path(filtered_profile), val(sequencer), val(assembler)

  output:
  tuple val(sample), val(assembler), path("profiling/metax/${sample}.metax.processed.filtered.profile.txt"), path("binning/${assembler}/${sample}/mags.done"), path("virulence/${assembler}/${sample}/blast_vfs_summary.txt"), path("virulence/${assembler}/${sample}/vfs.done"), path("amr/${assembler}/${sample}/predict_amrs_summary.txt"), path("amr/${assembler}/${sample}/amrs.done")

  script:
  def skipVirulenceFlag = params.skip_virulence ? '--skip-virulence' : ''
  def skipAmrFlag = params.skip_amr ? '--skip-amr' : ''
  """
  mkdir -p profiling/metax logging
  cp "${filtered_profile}" "profiling/metax/${sample}.metax.processed.filtered.profile.txt"

  cat > runtime.config.yaml <<EOF
sequencer: ${sequencer}
kraken2_db: ${params.kraken2_db}
VFDB_core: ${params.vfdb_core}
EOF

  python "${projectDir}/scripts/mag_vf_amr.py" \\
    -s "${sample}" \\
    -f "${nohuman_fastq}" \\
    -a "${assembler}" \\
    --topn ${params.topn} \\
    -t ${task.cpus} \\
    --logfile "logging/${sample}.${assembler}.vfs_amrs.log" \\
    -o . \\
    -c runtime.config.yaml \\
    --profile "profiling/metax/${sample}.metax.processed.filtered.profile.txt" \\
    ${skipVirulenceFlag} \\
    ${skipAmrFlag}

  touch "logging/${sample}.${assembler}.vfs_amrs.bench"
  """
}

process MATCH_PROFILE_VFS_AMRS {
  tag { "${sample}:${assembler}" }
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(sample), val(assembler), path(filtered_profile), path(mags_done), path(blast_vfs_summary), path(vfs_done), path(predict_amrs_summary), path(amrs_done)

  output:
  tuple val(sample), val(assembler), path("${assembler}/${sample}.profile.with_vfs_amrs.txt")

  script:
  """
  mkdir -p "${assembler}"
  csvtk join -tHkf "5;1;1" \\
    "${filtered_profile}" \\
    "${blast_vfs_summary}" \\
    "${predict_amrs_summary}" \\
    -o "${assembler}/${sample}.profile.with_vfs_amrs.txt"
  """
}

process GENERATE_READCOUNT_STATS {
  tag "readcount_stats"
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true

  input:
  path stats_files
  path processed_profiles

  output:
  path "metaxpath.combined_readcount_stats.txt"

  script:
  """
  mkdir -p qc/nohuman profiling/metax
  for f in ${stats_files.join(' ')}; do
    cp "\$f" qc/nohuman/
  done
  for f in ${processed_profiles.join(' ')}; do
    cp "\$f" profiling/metax/
  done

  python "${projectDir}/scripts/generate_readcount_stats.py" \\
    qc/nohuman \\
    ${processed_profiles.join(' ')} \\
    -o metaxpath.combined_readcount_stats.txt
  """
}

process GENERATE_PROFILE_REPORT {
  tag { assembler }
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(assembler), path(profiles)

  output:
  tuple val(assembler), path("${assembler}/metaxpath.combined_report.top${params.topn}.txt"), path("${assembler}/metaxpath.combined_report.top${params.topn}.html"), path("${assembler}/metaxpath.combined_report.simple.txt")

  script:
  """
  mkdir -p "${assembler}"
  python "${projectDir}/scripts/generate_profile_report.py" \\
    ${profiles.join(' ')} \\
    --top ${params.topn} \\
    -p metax \\
    -o "${assembler}/metaxpath.combined_report"
  """
}

process DOTPLOT {
  tag { assembler }
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(assembler), path(top_report_txt), path(top_report_html), path(simple_report_txt)

  output:
  tuple val(assembler), path("${assembler}/metaxpath.combined_report.top${params.topn}.txt"), path("${assembler}/metaxpath.combined_report.simple.txt"), path("${assembler}/metaxpath.combined_report.simple.dotplot.pdf")

  script:
  """
  mkdir -p "${assembler}"
  cp "${top_report_txt}" "${assembler}/metaxpath.combined_report.top${params.topn}.txt"
  cp "${simple_report_txt}" "${assembler}/metaxpath.combined_report.simple.txt"
  Rscript "${projectDir}/scripts/dotplot.R" \\
    -p "${assembler}/metaxpath.combined_report.simple.txt" \\
    -o "${assembler}/metaxpath.combined_report.simple.dotplot.pdf"
  """
}

process CLEAN_REPORT {
  tag { assembler }
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(assembler), path(top_report_txt), path(top_report_html), path(simple_report_txt)

  output:
  tuple val(assembler), path("${assembler}/metaxpath.combined_report.species_cleaned.top${params.topn}.txt"), path("${assembler}/metaxpath.combined_report.species_cleaned.simple.txt")

  script:
  """
  mkdir -p "${assembler}"
  python "${projectDir}/scripts/clean_species_combined_profile.py" \\
    "${top_report_txt}" \\
    -o "${assembler}/metaxpath.combined_report.species_cleaned"
  """
}

process CLEAN_DOTPLOT {
  tag { assembler }
  publishDir "${runOutDir}/final", mode: 'copy', overwrite: true, saveAs: { filename -> filename }

  input:
  tuple val(assembler), path(cleaned_top_report), path(cleaned_simple_report)

  output:
  path "${assembler}/metaxpath.combined_report.species_cleaned.simple.dotplot.pdf"

  script:
  """
  Rscript "${projectDir}/scripts/dotplot.R" \\
    -p "${cleaned_simple_report}" \\
    -o "${assembler}/metaxpath.combined_report.species_cleaned.simple.dotplot.pdf"
  """
}

workflow {
  Channel
    .fromPath(params.input, checkIfExists: true)
    .set { samplesheet_ch }

  validated_samplesheet_ch = INPUT_CHECK(samplesheet_ch)

  sample_rows_ch = validated_samplesheet_ch
    .splitCsv(header: true)
    .map { row ->
      def sample = row.sample?.toString()?.trim()
      def longReads = row.long_reads?.toString()?.trim()
      def seqType = row.sequencer?.toString()?.trim()

      if (!sample) {
        error "Samplesheet row has empty sample value: ${row}"
      }
      if (!longReads) {
        error "Samplesheet row has empty long_reads value for sample: ${sample}"
      }
      if (!new File(longReads).exists()) {
        error "Input file does not exist for sample ${sample}: ${longReads}"
      }

      seqType = seqType ?: params.sequencer
      if (!supportedSequencers.contains(seqType)) {
        error "Unsupported sequencer '${seqType}' for sample '${sample}'. Allowed: ${supportedSequencers.join(', ')}"
      }

      tuple(sample, file(longReads), seqType)
    }

  mv_fastq_ch = MV_FASTQ(sample_rows_ch)
  metax_profile_ch = METAX_PROFILE(mv_fastq_ch)
  metax_bam_ch = SAM2BAM(metax_profile_ch)
  SYLPH_PROFILE(mv_fastq_ch)

  metax_processing_input_ch = metax_bam_ch.map { sample, metax_bam, metax_profile, sequencer ->
    tuple(sample, metax_profile, sequencer)
  }
  processed_metax_ch = PROCESS_METAX(metax_processing_input_ch)

  mv_pred_seed_ch = mv_fastq_ch.map { sample, nohuman_fastq, nohuman_stats, sequencer ->
    tuple(sample, nohuman_fastq, sequencer)
  }
  processed_pred_seed_ch = processed_metax_ch.map { sample, processed_profile, filtered_profile, sequencer ->
    tuple(sample, filtered_profile, sequencer)
  }

  pred_seed_ch = mv_pred_seed_ch
    .join(processed_pred_seed_ch)
    .map { sample, nohuman_fastq, seqA, filtered_profile, seqB ->
      def seqType = seqA ?: seqB ?: params.sequencer
      tuple(sample, nohuman_fastq, filtered_profile, seqType)
    }

  pred_input_ch = pred_seed_ch.flatMap { sample, nohuman_fastq, filtered_profile, seqType ->
    assemblerList.collect { assembler ->
      tuple(sample, nohuman_fastq, filtered_profile, seqType, assembler)
    }
  }

  pred_vf_amr_ch = PRED_VFS_AMRS(pred_input_ch)

  merged_profile_ch = MATCH_PROFILE_VFS_AMRS(pred_vf_amr_ch)

  readcount_stats_input_ch = mv_fastq_ch.map { sample, nohuman_fastq, nohuman_stats, sequencer ->
    nohuman_stats
  }.collect()

  processed_profile_input_ch = processed_metax_ch.map { sample, processed_profile, filtered_profile, sequencer ->
    processed_profile
  }.collect()

  GENERATE_READCOUNT_STATS(readcount_stats_input_ch, processed_profile_input_ch)

  profiles_by_assembler_ch = merged_profile_ch
    .map { sample, assembler, merged_profile ->
      tuple(assembler, merged_profile)
    }
    .groupTuple()

  combined_report_ch = GENERATE_PROFILE_REPORT(profiles_by_assembler_ch)
  DOTPLOT(combined_report_ch)

  cleaned_report_ch = CLEAN_REPORT(combined_report_ch)
  CLEAN_DOTPLOT(cleaned_report_ch)
}
