// Common organisms for NCBI taxonomy lookup
// This provides instant autocomplete for frequently used taxa
// Users can also enter custom taxId if their organism is not in this list

export interface TaxonomyEntry {
  taxId: string;
  scientificName: string;
  commonName?: string;
  rank: string;
  category: string; // For grouping in UI
}

// Common metagenome and microbiome-related taxa
export const TAXONOMY_DATA: TaxonomyEntry[] = [
  // Metagenomes - Human
  { taxId: "408170", scientificName: "human gut metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "447426", scientificName: "human oral metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "539655", scientificName: "human skin metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "433733", scientificName: "human lung metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "1202446", scientificName: "human vaginal metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "749907", scientificName: "human nasopharyngeal metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "1202531", scientificName: "human urogenital metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "1076179", scientificName: "human milk metagenome", rank: "species", category: "Human Metagenome" },
  { taxId: "428", scientificName: "human metagenome", rank: "species", category: "Human Metagenome" },

  // Metagenomes - Animal
  { taxId: "410661", scientificName: "mouse gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "1510822", scientificName: "pig gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "1510823", scientificName: "chicken gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "749906", scientificName: "bovine gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "1510824", scientificName: "fish gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "1510825", scientificName: "insect gut metagenome", rank: "species", category: "Animal Metagenome" },
  { taxId: "1510826", scientificName: "invertebrate gut metagenome", rank: "species", category: "Animal Metagenome" },

  // Metagenomes - Environmental
  { taxId: "410658", scientificName: "soil metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "449393", scientificName: "freshwater metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "408172", scientificName: "marine metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "412755", scientificName: "sediment metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "527639", scientificName: "wastewater metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "556182", scientificName: "groundwater metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "717931", scientificName: "freshwater sediment metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "443218", scientificName: "marine sediment metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "527640", scientificName: "activated sludge metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "652676", scientificName: "hydrothermal vent metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "1034836", scientificName: "permafrost metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "939928", scientificName: "glacier metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "1169740", scientificName: "cold seep metagenome", rank: "species", category: "Environmental Metagenome" },
  { taxId: "527641", scientificName: "sludge metagenome", rank: "species", category: "Environmental Metagenome" },

  // Metagenomes - Plant/Agricultural
  { taxId: "556180", scientificName: "rhizosphere metagenome", rank: "species", category: "Plant Metagenome" },
  { taxId: "1348798", scientificName: "phyllosphere metagenome", rank: "species", category: "Plant Metagenome" },
  { taxId: "939929", scientificName: "compost metagenome", rank: "species", category: "Plant Metagenome" },
  { taxId: "1169741", scientificName: "root metagenome", rank: "species", category: "Plant Metagenome" },

  // Metagenomes - Other
  { taxId: "412532", scientificName: "air metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "1169742", scientificName: "dust metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "652107", scientificName: "biogas fermenter metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "718308", scientificName: "bioreactor metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "1379530", scientificName: "food metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "1437825", scientificName: "fermentation metagenome", rank: "species", category: "Other Metagenome" },
  { taxId: "256318", scientificName: "metagenome", rank: "species", category: "Other Metagenome" },

  // Common Host Organisms
  { taxId: "9606", scientificName: "Homo sapiens", commonName: "human", rank: "species", category: "Host Organism" },
  { taxId: "10090", scientificName: "Mus musculus", commonName: "house mouse", rank: "species", category: "Host Organism" },
  { taxId: "10116", scientificName: "Rattus norvegicus", commonName: "Norway rat", rank: "species", category: "Host Organism" },
  { taxId: "9913", scientificName: "Bos taurus", commonName: "cattle", rank: "species", category: "Host Organism" },
  { taxId: "9823", scientificName: "Sus scrofa", commonName: "pig", rank: "species", category: "Host Organism" },
  { taxId: "9031", scientificName: "Gallus gallus", commonName: "chicken", rank: "species", category: "Host Organism" },
  { taxId: "7955", scientificName: "Danio rerio", commonName: "zebrafish", rank: "species", category: "Host Organism" },
  { taxId: "7227", scientificName: "Drosophila melanogaster", commonName: "fruit fly", rank: "species", category: "Host Organism" },
  { taxId: "6239", scientificName: "Caenorhabditis elegans", commonName: "nematode", rank: "species", category: "Host Organism" },
  { taxId: "3702", scientificName: "Arabidopsis thaliana", commonName: "thale cress", rank: "species", category: "Host Organism" },

  // Common Bacteria
  { taxId: "562", scientificName: "Escherichia coli", rank: "species", category: "Bacteria" },
  { taxId: "1280", scientificName: "Staphylococcus aureus", rank: "species", category: "Bacteria" },
  { taxId: "287", scientificName: "Pseudomonas aeruginosa", rank: "species", category: "Bacteria" },
  { taxId: "1313", scientificName: "Streptococcus pneumoniae", rank: "species", category: "Bacteria" },
  { taxId: "1351", scientificName: "Enterococcus faecalis", rank: "species", category: "Bacteria" },
  { taxId: "1423", scientificName: "Bacillus subtilis", rank: "species", category: "Bacteria" },
  { taxId: "1773", scientificName: "Mycobacterium tuberculosis", rank: "species", category: "Bacteria" },
  { taxId: "210", scientificName: "Helicobacter pylori", rank: "species", category: "Bacteria" },
  { taxId: "1639", scientificName: "Listeria monocytogenes", rank: "species", category: "Bacteria" },
  { taxId: "573", scientificName: "Klebsiella pneumoniae", rank: "species", category: "Bacteria" },

  // Common Archaea
  { taxId: "2287", scientificName: "Methanobacterium formicicum", rank: "species", category: "Archaea" },
  { taxId: "2162", scientificName: "Methanobrevibacter smithii", rank: "species", category: "Archaea" },

  // Common Fungi
  { taxId: "4932", scientificName: "Saccharomyces cerevisiae", commonName: "baker's yeast", rank: "species", category: "Fungi" },
  { taxId: "5476", scientificName: "Candida albicans", rank: "species", category: "Fungi" },
  { taxId: "5061", scientificName: "Aspergillus niger", rank: "species", category: "Fungi" },
  { taxId: "5141", scientificName: "Neurospora crassa", rank: "species", category: "Fungi" },

  // Viruses (common)
  { taxId: "12814", scientificName: "Respiratory syncytial virus", rank: "species", category: "Virus" },
  { taxId: "11676", scientificName: "Human immunodeficiency virus 1", rank: "species", category: "Virus" },
  { taxId: "10298", scientificName: "Human alphaherpesvirus 1", commonName: "HSV-1", rank: "species", category: "Virus" },
  { taxId: "2697049", scientificName: "Severe acute respiratory syndrome coronavirus 2", commonName: "SARS-CoV-2", rank: "species", category: "Virus" },
];

// Search function for autocomplete
export function searchTaxonomy(query: string, limit: number = 10): TaxonomyEntry[] {
  if (!query || query.length < 2) return [];

  const lowerQuery = query.toLowerCase();

  // Score matches: exact start > word start > contains
  const scored = TAXONOMY_DATA.map(entry => {
    const name = entry.scientificName.toLowerCase();
    const common = entry.commonName?.toLowerCase() || "";
    const taxId = entry.taxId;

    let score = 0;

    // Exact taxId match
    if (taxId === query) {
      score = 1000;
    }
    // Name starts with query
    else if (name.startsWith(lowerQuery)) {
      score = 100;
    }
    // Common name starts with query
    else if (common.startsWith(lowerQuery)) {
      score = 90;
    }
    // Word in name starts with query
    else if (name.split(" ").some(word => word.startsWith(lowerQuery))) {
      score = 50;
    }
    // Word in common name starts with query
    else if (common.split(" ").some(word => word.startsWith(lowerQuery))) {
      score = 40;
    }
    // Name contains query
    else if (name.includes(lowerQuery)) {
      score = 20;
    }
    // Common name contains query
    else if (common.includes(lowerQuery)) {
      score = 10;
    }
    // Category contains query
    else if (entry.category.toLowerCase().includes(lowerQuery)) {
      score = 5;
    }

    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

// Get entry by taxId
export function getTaxonomyByTaxId(taxId: string): TaxonomyEntry | undefined {
  return TAXONOMY_DATA.find(entry => entry.taxId === taxId);
}

// Group entries by category for display
export function getTaxonomyByCategory(): Record<string, TaxonomyEntry[]> {
  const grouped: Record<string, TaxonomyEntry[]> = {};

  for (const entry of TAXONOMY_DATA) {
    if (!grouped[entry.category]) {
      grouped[entry.category] = [];
    }
    grouped[entry.category].push(entry);
  }

  return grouped;
}
