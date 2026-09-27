/** Real headers and first rows of the QIIME 2 Moving Pictures tutorial exports (biom convert, metadata, taxonomy). */
const T = "\t";
export const MP_SAMPLES = ["L1S8", "L1S57", "L1S140", "L5S104", "L5S155", "L5S240"];
export const MP_FEATURE_TABLE = [
  "# Constructed from biom file",
  ["#OTU ID", ...MP_SAMPLES].join(T),
  ["4b5eeb300368260019c1fbc7a3c718fc", "2595.0", "2806.0", "0.0", "10.0", "0.0", "0.0"].join(T),
  ["fe30ff0f71a38a39cf1717ec2be3a2fc", "0.0", "0.0", "0.0", "0.0", "0.0", "374.0"].join(T),
  "",
].join("\n");
export const MP_SAMPLE_METADATA = [
  "sample-id\tbarcode-sequence\tbody-site\tyear\tmonth\tday\tsubject\treported-antibiotic-usage\tdays-since-experiment-start",
  "#q2:types\tcategorical\tcategorical\tnumeric\tnumeric\tnumeric\tcategorical\tcategorical\tnumeric",
  "L1S8\tAGCTGACTAGTC\tgut\t2008\t10\t28\tsubject-1\tYes\t0",
  "L1S57\tACACACTATGGC\tgut\t2009\t1\t20\tsubject-1\tNo\t84",
  "L1S140\tATGGCAGCTCTA\tgut\t2008\t10\t28\tsubject-2\tYes\t0",
  "L5S104\tCAGTGTCAGGAC\ttongue\t2008\t10\t28\tsubject-1\tYes\t0",
  "L5S155\tATCTTAGACTGC\ttongue\t2009\t1\t20\tsubject-1\tNo\t84",
  "L5S240\tCTGGACTCATAG\ttongue\t2008\t10\t28\tsubject-2\tYes\t0",
  "",
].join("\n");
export const MP_TAXONOMY = [
  "Feature ID\tTaxon\tConfidence",
  "4b5eeb300368260019c1fbc7a3c718fc\tk__Bacteria; p__Bacteroidetes; c__Bacteroidia; o__Bacteroidales; f__Bacteroidaceae; g__Bacteroides; s__\t0.9958337221946401",
  "fe30ff0f71a38a39cf1717ec2be3a2fc\tk__Bacteria; p__Proteobacteria; c__Betaproteobacteria; o__Neisseriales; f__Neisseriaceae; g__; s__\t0.9999428120610714",
  "",
].join("\n");
/** The derived CSVs of testdata/explore/microbiome-moving-pictures (headers as shipped). */
export const MP_COUNTS_CSV = `feature_id,${MP_SAMPLES.join(",")}\n4b5eeb300368260019c1fbc7a3c718fc,2595,2806,0,10,0,0\nfe30ff0f71a38a39cf1717ec2be3a2fc,0,0,0,0,0,374\n`;
export const MP_SAMPLES_CSV = "sample,barcode,body_site,year,month,day,subject,antibiotic_usage,days_since_start\n" + MP_SAMPLE_METADATA.split("\n").slice(2).filter(Boolean).map((line) => line.split("\t").map((cell, i) => (i === 2 ? cell.replace(/ /g, "_") : cell)).join(",")).join("\n") + "\n";
export const MP_TAXONOMY_CSV = "feature_id,taxon,confidence\n" + MP_TAXONOMY.split("\n").slice(1).filter(Boolean).map((line) => line.split("\t").join(",")).join("\n") + "\n";
