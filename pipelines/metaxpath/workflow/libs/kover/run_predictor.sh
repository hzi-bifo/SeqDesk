#!/bin/bash
BASEDIR=$(dirname "$0")
species="$1"
samplePath="$2"
outPath="$3"

mkdir -p "${outPath}/kover/temp/kmer_lists"
mkdir -p "${outPath}/kover/${species}"

# Extract k-mers using dsk (installed via conda or on PATH)
dsk -out "${outPath}/kover/temp/kmer_lists/${species}.h5" \
    -out-tmp "${outPath}/kover/temp/kmer_lists/" -abundance-min 1 -kmer-size 31 \
    -file "${samplePath}" -verbose False

dsk2ascii -file "${outPath}/kover/temp/kmer_lists/${species}.h5" \
    -out "${outPath}/kover/temp/kmer_lists/${species}.txt"

# Run Kover prediction
python "${BASEDIR}/kover_predict.py" -s "${species}" -a -wd "${outPath}" \
    -o "${outPath}/kover/${species}/prediction" -sd "${BASEDIR}"

rm -f "${outPath}/kover/temp/kmer_lists/${species}.txt"
rm -f "${outPath}/kover/temp/kmer_lists/${species}.h5"
