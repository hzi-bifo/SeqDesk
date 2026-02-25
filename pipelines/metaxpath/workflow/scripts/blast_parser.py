#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import rich_click as click
from glob import glob
from os import path


@click.command()
@click.argument('indir', type=click.Path(exists=True))
def parse_blast_outs(indir):
    """
    Parse the blast output files and create a summary file
    """
    out_fh = open(path.join(indir, 'blast_vfs_summary.txt'), 'a')
    species_taxid_vfs = {}  
    glob_pattern = indir + '/*.mags.blast_vfs.txt'
    for blast_out in glob(glob_pattern):
        species_taxid = path.basename(
            blast_out).replace('.mags.blast_vfs.txt', '')
        vfs_list = []
        with open(blast_out) as f:

            for line in f:
                if line.startswith('#'):
                    continue
                cols = line.strip().split('\t')
                identity = float(cols[2])
                evalue = float(cols[10])
                bitscore = float(cols[11])
                if identity >= 70 and evalue <= 1e-10 and bitscore >= 100:
                    annotation = cols[12]
                    genename = annotation.split(' ')[0].replace(
                        '(', '').replace(')', '')
                    vfs_list.append(genename)
        species_taxid_vfs[species_taxid] = set(vfs_list)
    for species_taxid, vfs in species_taxid_vfs.items():
        if len(vfs) > 0:
            vfs_str = ','.join(vfs)
        else:
            vfs_str = 'no VFs in assembly'
        out_fh.write(f'{species_taxid}\t{vfs_str}\n')
    out_fh.close()


parse_blast_outs()
