BEGIN {
  FS = "\t";
  OFS = "\t";
}

NR == 1 {
  for (i = 1; i <= NF; i++) {
    header[$i] = i;
  }
  next;
}

NR > 1 {
  required[1] = "num_seqs";
  required[2] = "sum_len";
  required[3] = "min_len";
  required[4] = "avg_len";
  required[5] = "max_len";
  required[6] = "N50";
  required[7] = "Q20(%)";
  required[8] = "Q30(%)";
  required[9] = "AvgQual";

  for (i = 1; i <= 9; i++) {
    if (!(required[i] in header)) {
      printf "Missing expected seqkit stats column: %s\n", required[i] > "/dev/stderr";
      exit 1;
    }
  }

  print \
    $(header["num_seqs"]), \
    $(header["sum_len"]), \
    $(header["min_len"]), \
    $(header["avg_len"]), \
    $(header["max_len"]), \
    $(header["N50"]), \
    $(header["Q20(%)"]), \
    $(header["Q30(%)"]), \
    $(header["AvgQual"]);
  exit;
}
