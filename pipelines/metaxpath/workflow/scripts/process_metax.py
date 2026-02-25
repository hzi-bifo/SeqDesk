#!/usr/bin/env python3
# -*- coding: utf-8 -*-

'''
Process and filter Metax taxonomy profile output.
Handles both old (6/10-column) and new (13-column) Metax output formats.
'''

import click
import numpy as np
from os import path
import pandas as pd
from ete3 import NCBITaxa
from collections import defaultdict


@click.command()
@click.argument('profile', type=click.Path(exists=True))
@click.argument('outprefix', type=str)
@click.option(
    '-d',
    '--db',
    type=str,
    help="The folder to store the taxa.sqlite file.",
    default=path.join(path.expanduser('~'), '.etetoolkit'))
@click.option('--humanvirus', type=click.Path(exists=True),
                default=None,
                help='Text file of human virus species taxids, one per line')
@click.option('--contamination', type=click.Path(exists=True),
                default=None,
                help='Contamination table file in TSV')
@click.option('--new', is_flag=True, default=False,
                help='Input is from new version of Metax (>=0.9.x)')
@click.option('-n', '--normalize', is_flag=True, default=False,
                help='Re-normalize the filtered profile')
def process_metax(profile, outprefix, db, humanvirus, contamination, new, normalize):
    """Process and filter Metax output profile.

    Args:
        profile (path): The path to Metax output profile
        outprefix (str): The prefix of processed output files
        db (str): The folder to store the taxa.sqlite file
        humanvirus (path): The path to human virus species taxids file
        contamination (path): The table file containing contamination taxa and related info
    """
    if new:
        ncols = _detect_column_count(profile)
        if ncols >= 13:
            col_names = ['name', 'taxID', 'taxRank', 'numReads', 'depth', 'abundance',
                         'coverage', 'expCoverage', 'likelihoodBreadth',
                         'fixedChunkBreadth', 'flexChunkBreadth',
                         'expFlexChunkBreadth', 'likelihoodFlexChunkBreadth']
            if ncols > 13:
                col_names += [f'extra_{i}' for i in range(ncols - 13)]
        elif ncols >= 10:
            col_names = ['name', 'taxID', 'taxRank', 'numReads', 'depth', 'abundance',
                         'coverage', 'expCoverage', 'pValue', 'chunkCoverage']
        else:
            col_names = ['name', 'taxID', 'taxRank', 'numReads', 'depth', 'abundance']

        df_tmp = pd.read_csv(profile, sep='\t', header=None, names=col_names,
                             na_values=['NA'])[lambda x: x['taxRank'] == 'species']
        df_ = df_tmp
    else:
        df_ = (pd.read_csv(profile, sep='\t', header=None, names=[
            'name', 'taxID', 'taxRank', 'numReads', 'depth', 'abundance']
            )[lambda x: x['taxRank'] == 'species'])

    processed_profile = outprefix + '.profile.txt'
    filtered_profile = outprefix + '.filtered.profile.txt'

    out_cols = ['name', 'speciesName', 'taxRank', 'taxID', 'speciesTaxID', 'superkingdom',
                'isVirus', 'isContamination', 'numReads', 'depth', 'coverage', 'expCoverage', 'abundance']

    if df_.empty:
        with open(processed_profile, 'w') as fh:
            fh.write('\t'.join(out_cols))
        with open(filtered_profile, 'w') as fh:
            fh.write('\t'.join(out_cols))
        return

    if 'coverage' not in df_.columns:
        df_['coverage'] = np.nan
    if 'expCoverage' not in df_.columns:
        df_['expCoverage'] = np.nan

    bool_filter = df_["name"].str.startswith(
        ('cellular organism', 'root'), na=False)
    df = df_[~bool_filter]

    dbfile = path.join(db, "taxa.sqlite")
    global ncbi
    if path.exists(dbfile):
        ncbi = NCBITaxa(dbfile=dbfile)
    else:
        raise FileNotFoundError("taxa.sqlite not found in {}".format(db))

    global human_virus_taxids
    if humanvirus is not None:
        with open(humanvirus, 'r') as fh:
            human_virus_taxids = [int(taxid.strip()) for taxid in fh.readlines()]
    else:
        human_virus_taxids = []

    global contamination_taxids_dict
    contamination_taxids_dict = defaultdict(list)
    contamination_taxids_dict[9606] = ['remaining human contamination']
    if contamination is not None:
        contamination_df = pd.read_csv(contamination, sep='\t')
        for row in contamination_df.itertuples():
            contamination_taxids_dict[int(row.TaxId)].append(row.Comment)

    (df.loc[:, 'speciesName'], df.loc[:, 'speciesTaxID'],
     df.loc[:, 'superkingdom'], df.loc[:, 'isVirus'],
     df.loc[:, 'isContamination']) = zip(*df.apply(assign_more_cols, axis=1))

    df.sort_values(by='depth', inplace=True, ascending=False)

    df[out_cols].to_csv(processed_profile, sep='\t', index=False)

    filtered_df = df[(df.isVirus != 'nonhuman') &
       (df.speciesName != 'Homo sapiens')][out_cols]
    if normalize:
        filtered_df.loc[:, 'abundance'] = (100*filtered_df['abundance']/\
            filtered_df['abundance'].sum()).round(5)
    filtered_df.to_csv(
        filtered_profile, sep='\t', index=False)


def _detect_column_count(filepath):
    """Detect the number of columns in a tab-separated profile file."""
    with open(filepath, 'r') as fh:
        for line in fh:
            line = line.strip()
            if line:
                return len(line.split('\t'))
    return 0


def assign_more_cols(row):
    species_name = row['name']
    species_taxid = int(row['taxID'])

    lineage_taxids = ncbi.get_lineage(species_taxid)
    taxid_rank_dict = ncbi.get_rank(lineage_taxids)

    if species_taxid in contamination_taxids_dict:
        is_contamination = "; ".join(contamination_taxids_dict[species_taxid])
    else:
        overlap_taxa = set(lineage_taxids) & set(contamination_taxids_dict.keys())
        if overlap_taxa:
            contamination_comments = []
            for taxon in overlap_taxa:
                contamination_comments.append("; ".join(contamination_taxids_dict[taxon]))
            is_contamination = '; '.join(contamination_comments)
        else:
            is_contamination = ''

    for taxid, rank in taxid_rank_dict.items():
        if rank in ['superkingdom', 'domain', 'acellular root']:
            superkingdom = ncbi.get_taxid_translator([taxid])[taxid]
            if superkingdom == 'Viruses':
                if species_taxid in human_virus_taxids:
                    is_virus = 'human'
                else:
                    is_virus = 'nonhuman'
            else:
                is_virus = 'no'
            return species_name, species_taxid, superkingdom, is_virus, is_contamination


process_metax()
