// Client-safe, curated catalog shipped with the application (no executable plugins).
export const camiCatalog = {
  "cami2-marine": {
    title: "CAMI II Marine", samples: 10,
    sourcePage: "https://cami-challenge.org/datasets/marine/",
    citation: "https://doi.org/10.4126/FRL01-006425521",
    root: "https://frl.publisso.de/data/frl:6425521/marine",
    environment: "marine seafloor (simulated)",
    technologies: { short: { platform: "Illumina HiSeq", layout: "paired", readLengthBp: 150 }, long: { platform: "Pacific Biosciences", layout: "single", averageReadLengthBp: 3000 } },
  },
  "cami3-toy-human-gut": {
    title: "CAMI III toy human gut", samples: 20,
    sourcePage: "https://cami-challenge.org/datasets/toy-human-gut/",
    citation: "https://cami-challenge.org/datasets/toy-human-gut/",
    root: "https://s3.bi.denbi.de/swift/v1/cami3__human-gut-toy",
    environment: "human gut (simulated)",
    technologies: { short: { platform: "Illumina HiSeq", layout: "paired", readLengthBp: 150 }, long: { platform: "Oxford Nanopore R10", layout: "single", averageReadLengthBp: 3998 } },
  },
} as const;
