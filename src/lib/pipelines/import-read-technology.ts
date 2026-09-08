/** Import modules own their source metadata; single-end does not mean long-read. */
export function importedReadLengthClass(raw: string | null | undefined): "short" | "long" | null {
  try {
    const metadata = JSON.parse(raw || "{}");
    if (metadata.sourceType === "cami-benchmark") {
      return metadata.technology === "short" || metadata.technology === "long" ? metadata.technology : null;
    }
    if (metadata.sourceType === "ena-fastq-accession") {
      const platform = String(metadata.platform ?? metadata.instrumentPlatform ?? "").toUpperCase();
      if (/OXFORD_NANOPORE|PACBIO|PACIFIC_BIOSCIENCES/.test(platform)) return "long";
      if (/ILLUMINA|LS454|ION_TORRENT|BGISEQ|DNBSEQ|MGI|ELEMENT|ULTIMA/.test(platform)) return "short";
    }
  } catch { /* Missing or unrecognized provenance is not evidence of read length. */ }
  return null;
}
