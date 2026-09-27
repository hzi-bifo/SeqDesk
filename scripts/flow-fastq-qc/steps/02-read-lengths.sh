# Read statistics per mate and the read-length histogram with seqkit (in the shell base environment).
# Inputs: $INPUT_reads_1 / $INPUT_reads_2 (ENA ERR10419931, gzip FASTQ).
seqkit stats --quiet -a -T "$INPUT_reads_1" "$INPUT_reads_2" \
  | awk -F '\t' -v OFS='\t' 'NR == 1 { $1 = "mate"; print; next } { $1 = (NR == 2 ? "R1" : "R2"); print }' \
  | sed '1s/(%)/_pct/g' > "$OUT/read_stats.tsv"
sx table read_stats "$OUT/read_stats.tsv" --title "seqkit statistics per mate"

# Length histogram: mate, read length, number of reads.
{
  printf 'mate\tlength\treads\n'
  for mate in 1 2; do
    input_var="INPUT_reads_$mate"
    seqkit fx2tab -n -i -l "${!input_var}" | cut -f 2 | sort -n | uniq -c | awk -v OFS='\t' -v m="R$mate" '{ print m, $2, $1 }'
  done
} > "$OUT/length_histogram.tsv"
sx table length_histogram "$OUT/length_histogram.tsv" --title "Read-length histogram"

n_reads=$(awk -F '\t' 'NR > 1 { s += $4 } END { print s }' "$OUT/read_stats.tsv")
mean_len=$(awk -F '\t' 'NR > 1 { n += $4; b += $5 } END { printf "%.4f", b / n }' "$OUT/read_stats.tsv")
distinct=$(awk -F '\t' 'NR > 1 { seen[$2] = 1 } END { print length(seen) }' "$OUT/length_histogram.tsv")
sx metric n_reads "$n_reads" --label "Reads (both mates)" --unit reads --definition-json '{"what": "FASTQ records in both raw files", "method": "seqkit stats"}'
sx metric mean_length "$mean_len" --label "Mean read length" --unit bp --definition-json '{"what": "total bases / reads, both raw files", "method": "seqkit stats"}'
sx metric n_lengths "$distinct" --label "Distinct read lengths"
sx note "seqkit $(seqkit version | awk '{print $2}')"
