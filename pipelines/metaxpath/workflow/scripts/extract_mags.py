#!/usr/bin/env python3

# import subprocess
import rich_click as click
import pickle
import pathlib
from fastx_parser import seq_parser
from collections import defaultdict



@click.command()
@click.option('--contigs', required=True, type=str, help='contigs file')
@click.option('--contig_species', required=True, type=str, help='contig_species mapping file')
@click.option('--out_mags_dir', required=True, type=str, help='output mags dir')
def get_mags(contigs, contig_species, out_mags_dir):
    seq_dict = {}
    pathlib.Path(out_mags_dir).mkdir(parents=True, exist_ok=True)
    with open(contigs, 'r') as fh:
        for record in seq_parser(fh, 'fasta'):
            # contig name
            seq_name = record[0][1:].strip()
            # print(seq_name)
            seq = record[1]
            seq_dict[seq_name] = seq

    out_mags_dict = defaultdict(list)
    out_magsize_dict = defaultdict(int)

    with open(contig_species, 'r') as fh:
        for line in fh:
            contig_id, taxid, species_name, species_taxid = line.strip().split('\t')
            contig_id = contig_id.strip()
            species_name = species_name.replace(' ', '_')
            contig_seq = seq_dict[contig_id]
            out_mags_dict[species_taxid].append((f'>{species_name}|{species_taxid}|{taxid}|{contig_id}',
                                                 contig_seq))
            out_magsize_dict[species_taxid] += len(contig_seq)

    for species_taxid, bin_contigs in out_mags_dict.items():
        out_mags = f'{out_mags_dir}/{species_taxid}.mags.fasta'
        out_fh = open(out_mags, 'w')
        for bin_contig_id, bin_contig_seq in bin_contigs:
            out_fh.write(bin_contig_id + '\n')
            out_fh.write(bin_contig_seq + '\n')
        out_fh.close()
    
    mags_size_pkl = open(f"{out_mags_dir}/mags.size.pkl", "wb")
    pickle.dump(out_magsize_dict, mags_size_pkl)
    mags_size_pkl.close()

    open(f"{out_mags_dir}/mags.done", 'a').close()
    # return out_magsize_dict

get_mags()