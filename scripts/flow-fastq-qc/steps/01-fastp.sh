# Read QC with fastp on the paired reads, default trimming and filtering.
# Inputs: $INPUT_reads_1 / $INPUT_reads_2 (ENA ERR10419931, gzip FASTQ). Tools: fastp and jq (step packages).
threads="${PARAM_threads:-2}"
fastp -i "$INPUT_reads_1" -I "$INPUT_reads_2" -o "$TMPDIR/trimmed_1.fastq.gz" -O "$TMPDIR/trimmed_2.fastq.gz" \
  -j "$TMPDIR/fastp.json" -h "$TMPDIR/fastp.html" -w "$threads" 2> "$TMPDIR/fastp.log"
json="$TMPDIR/fastp.json"

# One row per stage: what fastp counted before and after filtering (both mates).
{
  printf 'stage\treads\tbases\tq20_pct\tq30_pct\tgc_pct\tmean_length_r1\tmean_length_r2\n'
  for stage in before_filtering after_filtering; do
    jq -r --arg s "$stage" '.summary[$s] | [$s, .total_reads, .total_bases, (.q20_rate * 100), (.q30_rate * 100), (.gc_content * 100), .read1_mean_length, .read2_mean_length] | @tsv' "$json"
  done
} > "$OUT/read_qc.tsv"
sx table read_qc "$OUT/read_qc.tsv" --title "Read QC before and after fastp"

field() { jq -r ".summary.$1" "$json"; }
reads_in=$(field before_filtering.total_reads)
reads_out=$(field after_filtering.total_reads)
q30=$(jq -r '.summary.before_filtering.q30_rate * 100' "$json")
gc=$(jq -r '.summary.before_filtering.gc_content * 100' "$json")

# Mean Phred quality over every base of both raw files (Phred+33), computed here, not by fastp.
mean_q=$(pigz -dc "$INPUT_reads_1" "$INPUT_reads_2" | LC_ALL=C awk '
  BEGIN { for (i = 33; i < 127; i++) q[sprintf("%c", i)] = i - 33 }
  NR % 4 == 0 { n = length($0); for (i = 1; i <= n; i++) s += q[substr($0, i, 1)]; b += n }
  END { printf "%.4f", s / b }')

sx metric reads_in "$reads_in" --label "Reads in" --unit reads --definition-json '{"what": "reads in both mates before fastp filtering", "method": "fastp"}'
sx metric reads_out "$reads_out" --label "Reads after fastp" --unit reads --definition-json '{"what": "reads in both mates that pass fastp default filters", "method": "fastp"}'
sx metric pct_reads_kept "$(awk -v a="$reads_out" -v b="$reads_in" 'BEGIN { printf "%.2f", 100 * a / b }')" --label "Reads kept" --unit "%"
sx metric pct_q30 "$(printf '%.2f' "$q30")" --label "Bases at Q30 or better" --unit "%" --definition-json '{"what": "share of raw bases with Phred quality >= 30, both mates", "method": "fastp"}'
sx metric gc_pct "$(printf '%.2f' "$gc")" --label "GC content" --unit "%" --definition-json '{"what": "G+C share of raw bases, both mates", "method": "fastp"}'
sx metric mean_quality "$mean_q" --label "Mean base quality" --unit Phred --definition-json '{"what": "mean Phred quality over all raw bases, both mates (Phred+33)", "method": "awk"}'
sx note "fastp $(fastp --version 2>&1 | awk '{print $2}') with default settings; jq $(jq --version | sed 's/^jq-//')"
