import pandas as pd
from ete3 import NCBITaxa
import rich_click as click
import numpy as np

# Rich-click settings (optional, for enhanced CLI formatting)
click.rich_click.USE_RICH_MARKUP = True

@click.command()
@click.argument('profile', type=click.Path(exists=True))
@click.option('-c', '--rcount', type=int, default=5, help='Read count threshold to keep a taxon.')
@click.option('-a', '--abundance', type=float, default=5, help='% Abundance threshold to reassign to higher rank.')
@click.option('-n', '--topn', type=int, default=10, help='Keep the top n most abundant taxa.')
@click.option('--output', '-o', type=click.Path(),
                required=True,
                help='Path to the output TSV file.')
def main(profile, rcount, abundance, topn, output):
    """
    This script processes a taxonomy profile TSV file, merging species-level taxa into their respective genera.
    """

    # Load the NCBI taxonomy database
    ncbi = NCBITaxa()

    # Define a small constant to replace zero or negative values
    EPSILON = 1e-10
    
    colnames = ['sampleName', 'taxonName', 'taxonID', 'superkingdom',
                'numReads', 'depth', 'coverage', 'expCoverage', 'abundance', 'perctReads']
    
    df = pd.read_csv(profile,
                        sep='\t',
                        usecols=range(10),
                        header=0
                        )
        
    df.columns = colnames
        
    dfs = {sample: df_subset for sample, df_subset in df.groupby('sampleName')}
    
    # df = raw_df[raw_df["numReads"] >= rcount].head(n=topn)

    def process_data(df_sample):
        # Get genus names for species
        def get_genus(taxid):
            lineage = ncbi.get_lineage(taxid)
            names = ncbi.get_taxid_translator(lineage)
            for tid in lineage:
                if ncbi.get_rank([tid])[tid] == 'genus':
                    return names[tid], tid
            return None, None
    
        # df = df[df['numReads'] >= rcount].head(n=topn)

        df_sample['coverage'] = df_sample['coverage'].fillna(0).astype(float).clip(lower=EPSILON)
        df_sample['expCoverage'] = df_sample['expCoverage'].fillna(0).astype(float).clip(lower=EPSILON)
        
        ft_df = df_sample[
            (df_sample['numReads'] >= rcount) &
            (np.abs(np.log2(df_sample['coverage'] / df_sample['expCoverage'])) <= 1)
        ]

        
        # Select the top `topn` rows based on abundance
        ft_top_df = ft_df.nlargest(topn, 'abundance')

        # Filter to keep only species with abundance < 3%
        low_abundance = ft_top_df[ft_top_df['abundance'] < abundance].copy()
        
        if len(low_abundance) == 0:
            return ft_top_df

        # Assign genus name and its taxonomy ID
        low_abundance[['genus', 'genusTaxonID']] = low_abundance.apply(lambda row: pd.Series(get_genus(row['taxonID'])), axis=1)

        # # Only group the species with more than 1 member to genus rank
        grouped_low_abundance = low_abundance.groupby(['genus', 'genusTaxonID']).filter(lambda x: len(x) > 1)
        
        # Get the genus read count, depth and abundance
        summed = grouped_low_abundance.groupby(['genus', 'genusTaxonID'],
        # summed = low_abundance.groupby(['genus', 'genusTaxonID'],
                                            as_index=False).agg({'numReads':'sum', 'depth':'sum', 
                                                                 'abundance':'sum', 'perctReads':'sum',
                                                                 'coverage':'mean', 'expCoverage':'mean'})

        # Round 'abundance', .. to five decimal places
        summed['numReads'] = summed['numReads'].round(5)
        summed['depth'] = summed['depth'].round(5)
        summed['abundance'] = summed['abundance'].round(5)
        summed['coverage'] = summed['coverage'].round(5)
        summed['expCoverage'] = summed['expCoverage'].round(5)
        summed['perctReads'] = summed['perctReads'].round(5)

        summed['taxonName'] = summed.genus
        summed['taxonRank'] = 'genus'
        summed['taxonID'] = summed.genusTaxonID

        # Keep taxa not in the low_abundance or are sole members in their genus
        kept_taxa = ft_top_df[~ft_top_df['taxonName'].isin(grouped_low_abundance['taxonName'])]
        # kept_taxa = ft_top_df[~ft_top_df['taxonName'].isin(low_abundance['taxonName'])]

        # Combine and return
        final_df = pd.concat([summed, kept_taxa], ignore_index=True, sort=False).fillna('')
        final_df.drop(columns=['genus', 'genusTaxonID'], inplace=True)
        return final_df.sort_values(by=['abundance'], ascending=False)
    
    out_dfs = []

    for sample, df in dfs.items():
        processed_df = process_data(df)
        processed_df['sampleName'] = sample
        out_dfs.append(processed_df)
    
    comb_df = pd.concat(out_dfs, ignore_index=True)
    # comb_df.columns = original_colnames
    comb_df[colnames].to_csv(output, sep='\t', index=False)

if __name__ == '__main__':
    main()