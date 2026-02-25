#!/usr/bin/env python3
# -*- coding: utf-8 -*-
'''
File: generate_profile_report.py
File Created: 1st January 1970
Author: ZL Deng <dawnmsg(at)gmail.com>
-----------------------------------------
Last Modified: 29th November 2021 5:01:15 pm
'''

# from collections import defaultdict
import rich_click as click
import pandas as pd
import re
from pretty_html_table import build_table
import numpy as np



@click.command()
@click.argument('profiles', type=click.Path(exists=True), nargs=-1)
@click.option('-p', '--profiler', type=click.Choice(('centrifuge', 'metax')), default='metax')
@click.option('--top', type=int, default=10)
@click.option('--out', '-o', type=click.Path(exists=False), default='profile_report')
def generate_report(profiles, profiler, top, out):
    """
    Generate a report of the profiles.
    """

    if profiler == 'centrifuge':
        # out_combined_df = centrifuge_report(profiles, top)
        cols_to_keep = ['sampleName', 'speciesName', 'speciesTaxID', 'superkingdom', 'isVirus',
                        'isContamination', 'genomeSize', 'numUniqueReads',
                        'numReads', 'numReadsPerMG', 'perctReads']
        numReads_col = 'numUniqueReads'
    else:
        # out_combined_df = metax_report(profiles, top)
        cols_to_keep = ['sampleName', 'speciesName', 'speciesTaxID', 'superkingdom', 
                        'numReads', 'depth', 'coverage', 'expCoverage', 
                        'abundance', 'perctReads', 'assembledVFs', 'AMRs', 
                        'isVirus', 'isContamination']
        numReads_col = 'numReads'

    out_dfs = []
    num_profiles = 0

    # out = out + '.top' + str(top)
    
    pattern = re.compile(r'\.profile\..*')

    # sample_sum_reads = {}
    # taxa_sum_reads = defaultdict(float)

    for profile in profiles:
        sample_name = pattern.sub('', profile.split('/')[-1])
        df = pd.read_csv(profile, sep='\t', header=0,
                        index_col=None)
        if not df.empty:
            # num_line = 0
            num_profiles += 1
            
            sum_reads = df[numReads_col].sum()
            # sample_sum_reads[sample_name] = sum_reads

            df.loc[:, 'perctReads'] = (100 * \
                df[numReads_col] / sum_reads).round(5)
            df.loc[:, 'sampleName'] = sample_name
            # df = df[cols_to_keep].copy()

            # if 'Homo sapiens' not in df.index:
            #     out_df = df.head(min(top, df.shape[0]))
            # else:
            #     row_idxs = []
            #     # df.loc['Homo sapiens', 'isContamination'] = 'yes'
            #     for idx, row in df.iterrows():
            #         if row.speciesName != 'Homo sapiens':
            #             num_line += 1
            #             if num_line < min(top, df.shape[0]):
            #                 row_idxs.append(idx)
            #             else:
            #                 break
            #         else:
            #             continue
            #     row_idxs.append('Homo sapiens')

            out_df = df[cols_to_keep]#.head(top)
            out_dfs.append(out_df)

    # if columns are the same the row index of different df can have duplications
    # combined_df = pd.concat(out_dfs, ignore_index=False)
    combined_full_df = pd.concat(out_dfs, ignore_index=True)
    
    taxa_sum_reads = combined_full_df.groupby('speciesTaxID')['numReads'].sum().to_dict()
    
    total_reads = combined_full_df['numReads'].sum()
    
    num_samples = combined_full_df['sampleName'].nunique()
    
    mean_reads_per_sample = total_reads/num_samples
    
    
    # samples with less than 1/10 of mean read number in the run
    low_biomass_sample_dict = (combined_full_df.groupby('sampleName')['numReads'].sum() <  (mean_reads_per_sample/10)).to_dict()
    

    # combined_full_df['barcode'] = combined_full_df['sampleName'].str.extract(r'barcode(\d+)a?$').astype(int)
    combined_full_df['barcode'] = combined_full_df['sampleName'].str.extract(r'[a-zA-Z]+(\d+)a?$').astype(int)
    # df_sorted = combined_full_df.sort_values(by='barcode')
    combined_df = combined_full_df.sort_values(by=['barcode', 'abundance'],
                                                ascending=[True, False]).groupby('sampleName').head(top)#.drop('barcode', axis=1)

    # max_reads_taxa_sample_df = combined_df.loc[combined_df.groupby('speciesTaxID')['numReads'].idxmax()]
    # max_reads_taxa_sample_dict = max_reads_taxa_sample_df.set_index('speciesTaxID')[['sampleName',
    #                                                     # 'speciesName',
    #                                                     'numReads',
    #                                                     # 'depth',
    #                                                     'abundance']].apply(tuple, axis=1).to_dict()
    
    # sum_reads_taxa_dict = combined_df.groupby('speciesTaxID')['numReads'].sum().to_dict()

    
        
    # combined_df['crossContamination'] = combined_df.apply(add_cross_contamination_note,
    #                                         axis=1,
    #                                         args=(max_reads_taxa_sample_dict,))
    
    combined_df['crossContamination'] = combined_df.apply(add_cross_contamination_note,
                                            axis=1,
                                            args=(taxa_sum_reads, low_biomass_sample_dict,))
    
    # # if sampleName contains "Ascites" we select the rows with depth > 0.005, if contains "Urine" we select the rows with depth > 0.1
    # # else do not filter anything
    # is_ascites = combined_df['sampleName'].str.contains('Ascites', case=False)
    # is_urine = combined_df['sampleName'].str.contains('Urine', case=False)
    # condition = (is_ascites & (combined_df['depth'] > 0.005)) | (is_urine & (combined_df['depth'] > 0.1)) | (~(is_ascites | is_urine))

    # # Filter the DataFrame
    # combined_df = combined_df[condition]
    # ft_df = df_sample[]
    
    simple_df_cols = ['sampleName', 'speciesName', 'speciesTaxID', 'superkingdom', 'numReads', 'depth',
                    'coverage', 'expCoverage', 'abundance', 'perctReads', 'crossContamination', 'AMRs', 'barcode']
    # simple_df = combined_df.loc[combined_df['crossContamination'].isna()][simple_df_cols]
    simple_df = combined_df.loc[(np.abs(np.log2(combined_df['coverage'] / combined_df['expCoverage'])) <= 1)][simple_df_cols]
    
    # top5_df = simple_df.groupby('sampleName', group_keys=False).apply(lambda x: x.nlargest(5, 'abundance')).reset_index(drop=True)

    top5_df = simple_df.sort_values(by=['barcode', 'abundance'],
                                                ascending=[True, False]).groupby('sampleName').head(5).drop('barcode', axis=1)


    # df = pd.DataFrame(np.arange(9).reshape(3, 3), list('ABC'), list('XYZ'))
    out_combined_df = combined_df.drop('barcode', axis=1)
    combined_html_table = build_table(out_combined_df, 'blue_light')
    # print(html_table_blue_light)
    with open(out + ".top" + str(top) + '.html', 'w', encoding='utf-8') as f:
        f.write(combined_html_table)

    
    simple_html_table = build_table(top5_df, 'orange_light')
    # print(html_table_blue_light)
    with open(out + '.simple.html', 'w', encoding='utf-8') as f:
        f.write(simple_html_table)


    # style_table(combined_df.style).to_html(out + '.html')
    out_combined_df.to_csv(out + ".top" + str(top) + '.txt', sep='\t', index=False)
    top5_df.to_csv(out + '.simple.txt', sep='\t', index=False)

# def rstr(df):
#     return df.shape, df.apply(lambda x: [x.unique()])

# # based on max 
# def add_cross_contamination_note(row, taxon_dict):
#     taxid = row['speciesTaxID']
#     current_sample = row['sampleName']
#     current_reads = row['numReads']
    
#     sample_with_max_reads, max_reads, _ = taxon_dict[taxid]
    
#     # if the current sample only have less than 5 reads, and another sample has more than 50 times reads,
#     # then it might be cross contamination
#     if current_reads < 100 and sample_with_max_reads != current_sample and max_reads >= 50 * current_reads:
#         times = int(max_reads // current_reads)
#         return f"{sample_with_max_reads} ({int(max_reads)}, {times}x)"
#     # else:
#     #     return None


#based on sum, only for low biomass samples
def add_cross_contamination_note(row, taxon_dict, low_biomass_dict):
    taxid = row['speciesTaxID']
    current_sample = row['sampleName']
    current_reads = row['numReads']
    sum_reads = taxon_dict[taxid]

    # if the current sample only have less than 100 reads, and sum reads of the taxon is 100 times more,
    # then it might be cross contamination
    if current_reads < 100 and sum_reads > 100 * current_reads:
        times = int(sum_reads // current_reads)
        # return f"total reads is {times}x"
        if low_biomass_dict[current_sample]:
            return f"Low biomass sample, total count is {times}x ({sum_reads})"
        else:
            return f"Not low biomass sample, total count is {times}x ({sum_reads})"
    
    else:
        return None

generate_report()
