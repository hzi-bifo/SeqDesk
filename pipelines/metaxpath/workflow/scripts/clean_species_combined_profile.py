import pandas as pd
from ete3 import NCBITaxa
import rich_click as click
import numpy as np

# Rich-click settings (optional, for enhanced CLI formatting)
click.rich_click.USE_RICH_MARKUP = True

@click.command()
@click.argument('profile', type=click.Path(exists=True))
# @click.option('-c', '--rcount', type=int, default=1, help='Read count threshold to keep a taxon.')
@click.option('-a', '--abundance', type=float, default=5, help='% Abundance threshold to reassign to the most abundant species in genus.')
# @click.option('-n', '--topn', type=int, default=10, help='Keep the top n most abundant taxa.')
@click.option('--out', '-o', type=click.Path(exists=False),
              required=True,
              help='Path to the output file prefix.')
def main(profile, abundance, out):
    """
    This script processes a taxonomy profile TSV file, merging low-abundance species into the most abundant species of the same genus.
    It should be ran on the simple combined profile output by generate_profile_report.py
    """
    # Load the NCBI taxonomy database
    ncbi = NCBITaxa()

    # top_extension = profile.replace('.*.top', '')
    top_extension = profile[profile.index(".top"):] if ".top" in profile else ".txt"
    
    # Define a small constant to replace zero or negative values
    # EPSILON = 1e-10
    
    # colnames = ['sampleName', 'taxonName', 'taxonID', 'superkingdom',
    #             'numReads', 'depth', 'coverage', 'expCoverage', 'abundance',
    #             'perctReads', 'crossContamination']

    colnames = ['sampleName', 'speciesName', 'speciesTaxID', 'superkingdom',
                'numReads', 'depth', 'coverage', 'expCoverage', 'abundance',
                'perctReads', 'assembledVFs', 'AMRs', 'isVirus', 'isContamination', 
                'crossContamination']

    simple_df_cols = ['sampleName', 'taxonName', 'taxonID', 'superkingdom', 'numReads', 'depth',
                    'coverage', 'expCoverage', 'abundance', 'perctReads', 'crossContamination', 'AMRs', 'barcode']
    
    # df = pd.read_csv(profile, sep='\t', usecols=range(11), header=0)
    # df.columns = colnames

    df = pd.read_csv(profile, sep='\t', header=0)[colnames]

    df = df.rename(columns={
        'speciesTaxID': 'taxonID',
        'speciesName':  'taxonName'
    })

    out_colnames = df.columns.tolist()
    
    dfs = {sample: df_subset for sample, df_subset in df.groupby('sampleName')}

    def process_data(df_sample):
        # Get genus names for species
        def get_genus(taxid):
            lineage = ncbi.get_lineage(taxid)
            names = ncbi.get_taxid_translator(lineage)
            for tid in lineage:
                if ncbi.get_rank([tid])[tid] == 'genus':
                    return names[tid], tid
            return None, None

        # df_sample['coverage'] = df_sample['coverage'].fillna(0).astype(float).clip(lower=EPSILON)
        # df_sample['expCoverage'] = df_sample['expCoverage'].fillna(0).astype(float).clip(lower=EPSILON)
        
        # # Filter taxa based on thresholds
        # ft_df = df_sample[(np.abs(np.log2(df_sample['coverage'] / df_sample['expCoverage'])) <= 1)]

        # Select the top `topn` rows based on abundance
        # ft_top_df = ft_df.nlargest(topn, 'abundance')

        # Filter species with abundance below threshold
        low_abundance = df_sample[df_sample['abundance'] < abundance].copy()
        
        if len(low_abundance) == 0:
            return df_sample

        # Assign genus name and its taxonomy ID
        low_abundance[['genus', 'genusTaxonID']] = low_abundance.apply(lambda row: pd.Series(get_genus(row['taxonID'])), axis=1)
        df_sample[['genus', 'genusTaxonID']] = df_sample.apply(lambda row: pd.Series(get_genus(row['taxonID'])), axis=1)
        kept_taxa = df_sample[~df_sample['taxonName'].isin(low_abundance['taxonName'])]
        # Find the most abundant species within each genus
        # keep the for non-numeric columns
        
        genus_leader = df_sample.groupby('genus').apply(
            lambda x: pd.Series({
                'genus': x.name,  # Explicitly include the genus column
                'taxonName': x.loc[x['abundance'].idxmax(), 'taxonName'],
                'taxonID': x.loc[x['abundance'].idxmax(), 'taxonID'],
                'superkingdom': x.loc[x['abundance'].idxmax(), 'superkingdom'],
                'assembledVFs': x.loc[x['abundance'].idxmax(), 'assembledVFs'],
                'AMRs': x.loc[x['abundance'].idxmax(), 'AMRs'],
                'isVirus': x.loc[x['abundance'].idxmax(), 'isVirus'],
                'isContamination': x.loc[x['abundance'].idxmax(), 'isContamination'],
                'crossContamination': x.loc[x['abundance'].idxmax(), 'crossContamination']
            }), include_groups=False
        ).reset_index(drop=True)

        # genus_leader = ft_top_df.groupby('genus', group_keys=False).apply(
        #     lambda x: x.loc[x['abundance'].idxmax()]
        # ).reset_index(drop=True)
            
        # Merge low-abundance species into their most abundant species
        merged = low_abundance.groupby(['genus', 'genusTaxonID']).apply(lambda group: {
            'taxonName': genus_leader.loc[genus_leader['genus'] == group.name[0], 'taxonName'].values[0],
            'taxonID': genus_leader.loc[genus_leader['genus'] == group.name[0], 'taxonID'].values[0],
            'superkingdom': genus_leader.loc[genus_leader['genus'] == group.name[0], 'superkingdom'].values[0],
            'numReads': group['numReads'].sum(),
            'depth': group['depth'].sum(),
            'coverage': group['coverage'].max(),
            'expCoverage': group['expCoverage'].max(),
            'abundance': group['abundance'].sum(),
            'perctReads': group['perctReads'].sum(),
            'assembledVFs': genus_leader.loc[genus_leader['genus'] == group.name[0], 'crossContamination'].values[0],
            'AMRs': genus_leader.loc[genus_leader['genus'] == group.name[0], 'AMRs'].values[0],
            'isVirus': genus_leader.loc[genus_leader['genus'] == group.name[0], 'isVirus'].values[0],
            'isContamination': genus_leader.loc[genus_leader['genus'] == group.name[0], 'isContamination'].values[0],
            'crossContamination': genus_leader.loc[genus_leader['genus'] == group.name[0], 'crossContamination'].values[0]
        }, include_groups=False).apply(pd.Series).reset_index(drop=True)
        
        # Concatenate merged low-abundance species with kept taxa
        combined_df = pd.concat([kept_taxa, merged], ignore_index=True)
        
        # Group by taxonName and taxonID to sum up values correctly
        final_df = combined_df.groupby(['taxonName', 'taxonID'], as_index=False).agg({
            'superkingdom': 'first',
            'numReads': 'sum',
            'depth': 'sum',
            'coverage': 'max',
            'expCoverage': 'max',
            'abundance': 'sum',
            'perctReads': 'sum',
            'assembledVFs': 'first',
            'AMRs': 'first',
            'isVirus': 'first',
            'isContamination': 'first',
            'crossContamination': 'first'
        })
        # final_df.loc[:,
        #             ('numReads', 'depth', 'coverage', 'expCoverage', 'abundance', 'perctReads')] = final_df.loc[:, 
        #     ('numReads', 'depth', 'coverage', 'expCoverage', 'abundance', 'perctReads')].map('{:.5}'.format)

        return final_df.round(5).sort_values(by=['abundance'], ascending=False)

    out_dfs = []
    for sample, df in dfs.items():
        processed_df = process_data(df)
        processed_df['sampleName'] = sample
        out_dfs.append(processed_df)

    comb_df = pd.concat(out_dfs, ignore_index=True)

    # add barcode column
    comb_df['barcode'] = comb_df['sampleName'].str.extract(r'[a-zA-Z]+(\d+)a?$').astype(int)
    
    # sort by barcode and abundance, then group by sampleName    
    comb_df = comb_df.sort_values(by=['barcode', 'abundance'],
                                                ascending=[True, False])#.groupby('sampleName')

    # save to file
    comb_df[out_colnames].to_csv(out + top_extension, sep='\t', index=False)

    simple_df = comb_df.loc[(np.abs(np.log2(comb_df['coverage'] / comb_df['expCoverage'])) <= 1)][simple_df_cols]
    
    top5_df = simple_df.groupby('sampleName').head(5).drop('barcode', axis=1)
    top5_df.to_csv(out + '.simple.txt', sep='\t', index=False)


if __name__ == '__main__':
    main()
