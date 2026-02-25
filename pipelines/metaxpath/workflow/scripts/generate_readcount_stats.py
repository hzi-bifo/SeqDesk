#!/usr/bin/env python3
# -*- coding: utf-8 -*-
'''
File: generate_profile_report.py
File Created: 1st January 1970
Author: ZL Deng <dawnmsg(at)gmail.com>
-----------------------------------------
Last Modified: 29th November 2021 5:01:15 pm
'''

import rich_click as click
import pandas as pd
import re
import os
# from pretty_html_table import build_table



@click.command()
@click.argument('data_dir', type=click.Path(exists=True))
@click.argument('profiles', type=click.Path(exists=True), nargs=-1)
@click.option('--out', '-o', type=click.Path(exists=False), default='profile_report')
def generate_stats(data_dir, profiles, out):
    """
    Generate a readcount stats report for the whole run.
    """
    
    run_pattern = re.compile(r'([^/]*?)/profiling/')
    # sample_pattern = re.compile(rf'\.profile\..*')
    
    df_dict = {'run': [], 'sampleName': [], 'totalReads': [],
               'remainHumanReads': [],
               'humanReads': [], '% humanPert': [], 
               'nonhumanReads': [], '% nonhumanPert': [],
               'classifiedReads': [], '% classifiedPert': []}
    
    stats_files = [stats_file for stats_file in os.listdir(data_dir) if stats_file.endswith('.stats')]
    renamed = False if stats_files[0].startswith('barcode') else True

    for profile in profiles:
        run = run_pattern.search(profile).group(1).rsplit('_', 1)[1]
        
        # sample_name = sample_pattern.sub('', profile.split('/')[-1])
        # sample_name = profile.split('/')[-1].split('.', 1)[0]
        sample_name = re.sub(r'\.metax.*', '', profile.split('/')[-1])
        
        # print(sample_name)
        if renamed:
            nonhuman_stats_file = os.path.join(data_dir, f'{sample_name}.nohuman_fract.stats')
        else:
            barcode = sample_name.rsplit('_', 1)[1]
            
            # print(barcode)
            
            nonhuman_stats_file = os.path.join(data_dir, f'{barcode}.nohuman_fract.stats')
        total_reads, nohuman_reads = map(int,
                                        open(nonhuman_stats_file,
                                            'r',
                                            encoding='utf-8').readline().strip().split('\t'))

        df = pd.read_csv(profile, sep='\t', header=0,
                        index_col=0)
        num_remain_human = 0
        if not df.empty:

            if 'Homo sapiens' in df.index:
                # out_df = df.head(min(top, df.shape[0]))
                
            # else:
                num_remain_human = df.loc['Homo sapiens', 'numReads']

            classified_reads = df.numReads.sum() - num_remain_human
        else:
            classified_reads = 0
        
        actual_human_reads = (total_reads - nohuman_reads) + num_remain_human
        actual_nohuman_reads = nohuman_reads - num_remain_human
        
        # todo: sort by barcode number
        df_dict['run'].append(run)
        df_dict['sampleName'].append(sample_name)
        df_dict['totalReads'].append(total_reads)
        df_dict['remainHumanReads'].append(round(num_remain_human, 2))

        df_dict['humanReads'].append(round(actual_human_reads, 2))
        df_dict['% humanPert'].append(round((actual_human_reads / total_reads) * 100, 2))
        df_dict['nonhumanReads'].append(round(actual_nohuman_reads, 2))
        df_dict['% nonhumanPert'].append(round((actual_nohuman_reads / total_reads) * 100, 2))

        df_dict['classifiedReads'].append(round(classified_reads, 2))
        if actual_nohuman_reads == 0:
            df_dict['% classifiedPert'].append(100)
        else:
            df_dict['% classifiedPert'].append(round((classified_reads / actual_nohuman_reads) * 100, 2))
        
    df = pd.DataFrame.from_dict(df_dict)
    
    df["barcode"] = df["sampleName"].str.extract(r'[a-zA-Z]+(\d+)a?$').astype(int)

    out_df = df.sort_values(by=['barcode'], ascending=[True]).drop('barcode', axis=1)
    
    out_df.to_csv(out, sep='\t', index=False)


generate_stats()
