import sys
import subprocess
import json
import rich_click as click
import yaml
import pathlib
import logging
from os import path
from fastx_parser import seq_parser
from collections import defaultdict


@click.command()
@click.option('--sample', '-s',
              help='The sample name', required=True)
@click.option('--fastq', '-f', type=click.Path(exists=True),
              help='The fastq file', required=True)
@click.option('--topn', type=int,
              help='The number of top species to keep', default=10)
@click.option('--assembler', '-a',
              type=click.Choice(('flye', 'myloasm', 'strainberry')),
              help='The assembler name', required=True)
@click.option('--outdir', '-o', type=click.Path(),
              help='The output directory', required=True)
@click.option('--resume', '-r', help='Resume from a previous run', is_flag=True)
@click.option('--threads', '-t', help='The number of threads', required=True)
@click.option('--logfile', help='The log file', default=None)
@click.option('--config', '-c', help='The config file',
              default='../config/config.yaml')
@click.option('--profile', type=click.Path(exists=True), default=None,
              help='Optional path to processed filtered profile')
@click.option('--skip-virulence', is_flag=True, default=False,
              help='Skip virulence factor search')
@click.option('--skip-amr', is_flag=True, default=False,
              help='Skip AMR prediction')
def runner(sample, fastq, topn, assembler, outdir, resume, threads, logfile, config,
           profile, skip_virulence, skip_amr):
    """Assembly, binning, virulence factor detection, and AMR prediction for a sample."""
    handlers = [logging.StreamHandler()]
    if logfile is not None:
        handlers.append(logging.FileHandler(logfile, mode='w'))
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s,%(msecs)03d %(name)s %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        handlers=handlers
    )

    logger = logging.getLogger('PREDICT_VF_AMR')

    cd = path.dirname(path.abspath(__file__))
    pipeline_dir = path.dirname(cd)

    with open(config, 'r', encoding='utf-8') as fh:
        logger.info('Loading config file: %s', config)
        cfg = yaml.safe_load(fh)

    profiling_dir = f"{outdir}/profiling"
    assembly_dir = f"{outdir}/assembly"
    binning_dir = f"{outdir}/binning"
    virulence_dir = f"{outdir}/virulence"
    amr_dir = f"{outdir}/amr"

    if profile is None:
        profile = f"{profiling_dir}/metax/{sample}.metax.processed.filtered.profile.txt"

    flye_outdir = f"{assembly_dir}/flye/{sample}"
    myloasm_outdir = f"{assembly_dir}/myloasm/{sample}"
    sberry_outdir = f"{assembly_dir}/strainberry/{sample}"

    binning_outdir = f"{binning_dir}/{assembler}/{sample}"
    virulence_outdir = f"{virulence_dir}/{assembler}/{sample}"
    amr_outdir = f"{amr_dir}/{assembler}/{sample}"

    top_species_classify = f"{binning_outdir}/metax.top_species.classify.txt"
    no_top_species_classify = f"{binning_outdir}/metax.no_top_species.classify.txt"
    done_out_mags = f"{binning_outdir}/mags.done"
    done_blast_virulence = f"{virulence_outdir}/vfs.done"
    done_predict_amr = f"{amr_outdir}/amrs.done"
    done_files = [done_out_mags, done_blast_virulence, done_predict_amr]

    logger.info('Creating output directories')

    if assembler in ('flye', 'strainberry'):
        pathlib.Path(flye_outdir).mkdir(parents=True, exist_ok=True)
    if assembler == 'strainberry':
        pathlib.Path(sberry_outdir).mkdir(parents=True, exist_ok=True)
    if assembler == 'myloasm':
        pathlib.Path(myloasm_outdir).mkdir(parents=True, exist_ok=True)

    pathlib.Path(binning_outdir).mkdir(parents=True, exist_ok=True)
    pathlib.Path(virulence_outdir).mkdir(parents=True, exist_ok=True)
    pathlib.Path(amr_outdir).mkdir(parents=True, exist_ok=True)

    vfs_summary_file = f"{virulence_outdir}/blast_vfs_summary.txt"
    if not path.exists(vfs_summary_file) or not resume:
        with open(vfs_summary_file, 'w', encoding='utf-8') as fh:
            fh.write('speciesTaxID\tassembledVFs\n')

    amrs_summary_file = f"{amr_outdir}/predict_amrs_summary.txt"
    if not path.exists(amrs_summary_file) or not resume:
        with open(amrs_summary_file, 'w', encoding='utf-8') as fh:
            fh.write('speciesTaxID\tAMRs\n')

    with open(profile, 'r', encoding='utf-8') as fh:
        if len(fh.readlines()) <= 1:
            logger.info('Empty profile for sample %s, skipping', sample)
            for df in done_files:
                pathlib.Path(df).touch()
            sys.exit(0)

    # --- Assembly ---
    if assembler == "myloasm":
        contigs = _run_myloasm(
            logger, cfg, sample, fastq, threads, resume,
            myloasm_outdir, done_files)

    elif assembler == "strainberry":
        contigs = _run_strainberry(
            logger, sample, fastq, threads, resume,
            flye_outdir, sberry_outdir, pipeline_dir, done_files)

    else:
        contigs = _run_flye(
            logger, sample, fastq, threads, resume,
            flye_outdir, done_files)

    # --- Binning with Kraken2 ---
    classify = f'{binning_outdir}/classify.txt'
    species_classify = f'{binning_outdir}/species.classify.txt'

    if not path.exists(species_classify) or not resume:
        report = f"{binning_outdir}/report.txt"
        kraken_db = cfg['kraken2_db']
        unclf = f'{binning_outdir}/unclf.fasta'
        logger.info('Binning %s contigs with Kraken2', assembler)
        subprocess.run(
            ["kraken2", "--db", kraken_db, "--threads", str(threads),
             contigs, "--unclassified-out", unclf,
             "--output", classify, "--report", report],
            check=True)

        logger.info('Filtering for species rank')
        subprocess.run(
            fr"""taxonkit reformat -I 2 -f '{{s}}' -t <(awk -F"\t" '$1=="C"{{print $2"\t"$3}}' """
            fr"""{classify})|awk -F"\t" '$4!=""' > {species_classify}""",
            shell=True, check=True, executable='/bin/bash')

    if (not path.exists(top_species_classify) and
            not path.exists(no_top_species_classify)) or not resume:
        logger.info('Filtering for top %d species', topn)
        subprocess.run(f"""
        if [ $(wc -l < {profile}) -gt 1 ] && [ $(wc -l < {species_classify}) -ge 1 ]; then
            csvtk grep -Htf 4 -j 1 -P <(sed -n '1!p' {profile}|head -{topn}|cut -f5) {species_classify} \
                -o {top_species_classify}
        else
            touch {top_species_classify}
        fi
        if [ $(wc -l < {top_species_classify}) -lt 1 ]; then
            rm -f {top_species_classify}
            touch {no_top_species_classify}
        fi
        """, shell=True, check=True, executable='/bin/bash')

    if path.exists(no_top_species_classify):
        logger.info('Sample %s has no top species, skipping MAG extraction', sample)
        for df in done_files:
            pathlib.Path(df).touch()
        sys.exit(0)

    # --- MAG extraction ---
    mags_size_json = f"{binning_outdir}/mags.size.json"
    mags_size_pkl = f"{binning_outdir}/mags.size.pkl"

    if not path.exists(done_out_mags) or \
            (not path.exists(mags_size_json) and not path.exists(mags_size_pkl)) or \
            not resume:
        logger.info('Extracting contigs for top MAGs')
        out_magsize_dict = get_mags(contigs, top_species_classify, binning_outdir)
    else:
        if path.exists(mags_size_json):
            with open(mags_size_json, 'r', encoding='utf-8') as fh:
                out_magsize_dict = json.load(fh)
        elif path.exists(mags_size_pkl):
            import pickle
            with open(mags_size_pkl, 'rb') as fh:
                out_magsize_dict = pickle.load(fh)

    # --- Virulence factor search ---
    if skip_virulence:
        logger.info('Skipping virulence factor search')
        pathlib.Path(done_blast_virulence).touch()
    elif not path.exists(done_blast_virulence) or not resume:
        vf_ref = cfg['VFDB_core']
        if not path.isabs(vf_ref):
            vf_ref = path.join(pipeline_dir, vf_ref)
        if not path.exists(vf_ref):
            raise FileNotFoundError(f'VFDB_core not found: {vf_ref}')
        if not path.exists(f'{vf_ref}.nhr'):
            logger.info('BLAST index missing for %s, running makeblastdb', vf_ref)
            subprocess.run(
                ["makeblastdb", "-dbtype", "nucl", "-in", vf_ref],
                check=True
            )
        logger.info('Searching VFs in MAGs')
        subprocess.run(f"""
        if [ $(ls {binning_outdir}/*.mags.fasta 2>/dev/null | wc -l) -gt 0 ]; then
            ls {binning_outdir}/*.mags.fasta | rush -j 1 'blastn -num_threads {threads} -max_target_seqs 100 -query \
                {{}} -db {vf_ref} \
                -outfmt "7 std stitle qcovs" -evalue 1e-5 -out {{.}}.blast_vfs.txt'
            mv {binning_outdir}/*.blast_vfs.txt {virulence_outdir}/
            python {cd}/blast_parser.py {virulence_outdir}
        else
            echo "No MAGs found"
        fi
        touch {done_blast_virulence}
        """, shell=True, check=True, executable='/bin/bash')

    # --- AMR prediction ---
    if skip_amr:
        logger.info('Skipping AMR prediction')
        pathlib.Path(done_predict_amr).touch()
    elif not path.exists(done_predict_amr) or not resume:
        predictor = path.join(pipeline_dir, 'libs', 'kover', 'run_predictor.sh')
        species_with_amrp = path.join(pipeline_dir, 'data', 'pathogens',
                                      'pathogen_species.taxid.gsize.with_amrp.txt')
        resfinder_db = path.join(pipeline_dir, 'data', 'resfinder', 'resfinder_db')
        pointfinder_db = path.join(pipeline_dir, 'data', 'resfinder', 'pointfinder_db')

        with open(amrs_summary_file, 'a', encoding='utf-8') as out_amrs_fh, \
             open(species_with_amrp, 'r', encoding='utf-8') as fh:

            for line in fh:
                if line.startswith('#'):
                    continue
                tools, species, taxid, gsize = line.strip().split('\t')
                tools = tools.split(';')
                taxid_mag_file = f'{binning_outdir}/{taxid}.mags.fasta'

                if not path.exists(taxid_mag_file):
                    continue

                amrs = {}
                coverage_ratio = out_magsize_dict.get(taxid, 0) / float(gsize)

                if coverage_ratio >= 0.6:
                    _predict_amr_from_assembly(
                        logger, tools, species, taxid, taxid_mag_file,
                        amr_outdir, resfinder_db, pointfinder_db, amrs)
                    if 'Kover' in tools:
                        _predict_amr_kover(
                            logger, species, taxid_mag_file, amr_outdir,
                            predictor, amrs)
                else:
                    _predict_amr_from_reads(
                        logger, tools, species, taxid, fastq,
                        amr_outdir, resfinder_db, pointfinder_db, amrs)

                if amrs:
                    amr_label_list = [f'{abt}:{label}' for abt, label in amrs.items()]
                    out_amrs_fh.write(f'{taxid}\t{",".join(amr_label_list)}\n')

        pathlib.Path(done_predict_amr).touch()


# ---------------------------------------------------------------------------
# Assembly helpers
# ---------------------------------------------------------------------------

def _run_flye(logger, sample, fastq, threads, resume, flye_outdir, done_files):
    """Run Flye metagenomic assembly. Returns path to contigs."""
    flye_contigs = f"{flye_outdir}/assembly.fasta"
    if not path.exists(flye_contigs) or not resume:
        flye_cmd = ["flye", "--nano-raw", fastq,
                    "-o", flye_outdir, "-t", str(threads), "--meta"]
        try:
            logger.info('Running Flye assembly: %s', ' '.join(flye_cmd))
            subprocess.run(flye_cmd, check=True)
        except subprocess.CalledProcessError:
            logger.info('Flye assembly failed for sample %s', sample)
            pathlib.Path(f"{flye_outdir}/flye.error").touch()
            for df in done_files:
                pathlib.Path(df).touch()
            sys.exit(0)
    return flye_contigs


def _run_myloasm(logger, cfg, sample, fastq, threads, resume,
                 myloasm_outdir, done_files):
    """Run myloasm metagenomic assembly. Returns path to contigs."""
    myloasm_contigs = f"{myloasm_outdir}/assembly_primary.fa"
    if not path.exists(myloasm_contigs) or not resume:
        sequencer_type = cfg.get('sequencer', 'Nanopore')
        myloasm_cmd = ["myloasm", fastq,
                       "-o", myloasm_outdir, "-t", str(threads),
                       "--clean-dir"]
        if sequencer_type == "PacBio":
            myloasm_cmd.append("--hifi")
        try:
            logger.info('Running myloasm assembly: %s', ' '.join(myloasm_cmd))
            subprocess.run(myloasm_cmd, check=True)
        except subprocess.CalledProcessError:
            logger.info('myloasm assembly failed for sample %s', sample)
            pathlib.Path(f"{myloasm_outdir}/myloasm.error").touch()
            for df in done_files:
                pathlib.Path(df).touch()
            sys.exit(0)
    return myloasm_contigs


def _run_strainberry(logger, sample, fastq, threads, resume,
                     flye_outdir, sberry_outdir, pipeline_dir, done_files):
    """Run Flye + Strainberry assembly pipeline. Returns path to contigs."""
    flye_contigs = _run_flye(
        logger, sample, fastq, threads, resume, flye_outdir, done_files)

    reads_flye_bam = f"{flye_outdir}/bam/read_to_contig.bam"
    if not path.exists(reads_flye_bam + '.bai') or not resume:
        pathlib.Path(f"{flye_outdir}/bam").mkdir(parents=True, exist_ok=True)
        logger.info('Generating BAM of reads and Flye contigs')
        subprocess.run(
            f"minimap2 -ax map-ont {flye_contigs} {fastq} -t {threads} "
            f"| samtools view -bh - | samtools sort -o {reads_flye_bam} && "
            f"samtools faidx {flye_contigs} && "
            f"samtools index {reads_flye_bam}",
            shell=True, check=True, executable='/bin/bash')

    sberry_contigs = f"{sberry_outdir}/assembly.scaffolds.fa"
    if not path.exists(sberry_contigs) or not resume:
        sberry_bin = path.join(pipeline_dir, 'libs', 'strainberry', 'strainberry')
        logger.info('Running Strainberry assembly')
        subprocess.run(
            f'if [ $(grep -Ec "^>" {flye_contigs}) -le 2 ]; then '
            f'cp {flye_contigs} {sberry_contigs}; '
            f'else {sberry_bin} -c {threads} -r {flye_contigs} '
            f'-b {reads_flye_bam} -o {sberry_outdir}; fi',
            shell=True, check=True, executable='/bin/bash')
    return sberry_contigs


# ---------------------------------------------------------------------------
# AMR prediction helpers
# ---------------------------------------------------------------------------

def _predict_amr_from_assembly(logger, tools, species, taxid, mag_file,
                                amr_outdir, resfinder_db, pointfinder_db, amrs):
    """Run assembly-based AMR prediction with ResFinder (+PointFinder if applicable)."""
    try:
        if 'Pointfinder' in tools:
            logger.info('Predicting AMR for %s with ResFinder/PointFinder (assembly)', species)
            subprocess.run(
                ["python3", "-m", "resfinder", "-s", species,
                 "-ifa", mag_file,
                 "-o", f"{amr_outdir}/resfinder/{taxid}_contigs",
                 "--min_cov", "0.6", "--threshold", "0.8",
                 "-acq", "--point",
                 "-db_res", resfinder_db, "-db_point", pointfinder_db],
                check=True)
        else:
            logger.info('Predicting AMR for %s with ResFinder (assembly)', species)
            subprocess.run(
                ["python3", "-m", "resfinder",
                 "-ifa", mag_file,
                 "-o", f"{amr_outdir}/resfinder/{taxid}_contigs",
                 "--min_cov", "0.6", "--threshold", "0.8",
                 "-acq", "-db_res", resfinder_db],
                check=True)
        _parse_resfinder_output(
            f'{amr_outdir}/resfinder/{taxid}_contigs/pheno_table.txt', amrs)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning('ResFinder failed for %s (assembly): %s', species, e)


def _predict_amr_from_reads(logger, tools, species, taxid, fastq,
                             amr_outdir, resfinder_db, pointfinder_db, amrs):
    """Run read-based AMR prediction with ResFinder (+PointFinder if applicable)."""
    try:
        if 'Pointfinder' in tools:
            logger.info('Predicting AMR for %s with ResFinder/PointFinder (reads)', species)
            subprocess.run(
                ["python3", "-m", "resfinder", "-s", species,
                 "-ifq", fastq,
                 "-o", f"{amr_outdir}/resfinder/{taxid}_reads",
                 "--min_cov", "0.6", "--threshold", "0.8",
                 "-acq", "-c",
                 "-db_res", resfinder_db,
                 "-db_res_kma", f"{resfinder_db}/kma_indexing",
                 "-db_point", pointfinder_db, "--nanopore"],
                check=True)
        else:
            logger.info('Predicting AMR for %s with ResFinder (reads)', species)
            subprocess.run(
                ["python3", "-m", "resfinder",
                 "-ifq", fastq,
                 "-o", f"{amr_outdir}/resfinder/{taxid}_reads",
                 "--min_cov", "0.6", "--threshold", "0.8",
                 "-acq", "-db_res", resfinder_db,
                 "-db_res_kma", f"{resfinder_db}/kma_indexing", "--nanopore"],
                check=True)
        _parse_resfinder_output(
            f'{amr_outdir}/resfinder/{taxid}_reads/pheno_table.txt', amrs)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning('ResFinder failed for %s (reads): %s', species, e)


def _predict_amr_kover(logger, species, mag_file, amr_outdir, predictor, amrs):
    """Run Kover k-mer based AMR prediction."""
    kover_species = species.replace(' ', '_')
    logger.info('Predicting AMR for %s with Kover', species)
    try:
        subprocess.run(
            ["bash", predictor, kover_species, mag_file, amr_outdir],
            check=True)
        kover_pred_table = f'{amr_outdir}/kover/{kover_species}/prediction_result.txt'
        with open(kover_pred_table, 'r', encoding='utf-8') as fh:
            fh.readline()
            for amr_line in fh:
                abt, label = amr_line.strip().split('\t')
                amrs[abt.lower()] = label
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning('Kover prediction failed for %s: %s', species, e)


def _parse_resfinder_output(pheno_table_path, amrs):
    """Parse ResFinder pheno_table.txt and update the amrs dict."""
    with open(pheno_table_path, 'r', encoding='utf-8') as fh:
        for line in fh:
            if line.startswith('#'):
                continue
            cols = line.strip().split('\t')
            if len(cols) < 4:
                continue
            abt, _abt_class, label, _genetic_count = cols[:4]
            amrs[abt.lower()] = '1' if label == 'Resistant' else '0'


# ---------------------------------------------------------------------------
# MAG extraction
# ---------------------------------------------------------------------------

def get_mags(contigs, species_classify, out_mags_dir):
    """Extract contigs for each species into separate MAG FASTA files."""
    seq_dict = {}
    with open(contigs, 'r', encoding='utf-8') as fh:
        for record in seq_parser(fh, 'fasta'):
            seq_name = record[0][1:].strip().split()[0]
            seq_dict[seq_name] = record[1]

    out_mags_dict = defaultdict(list)
    out_magsize_dict = defaultdict(int)

    with open(species_classify, 'r', encoding='utf-8') as fh:
        for line in fh:
            contig_id, taxid, species_name, species_taxid = line.strip().split('\t')
            contig_id = contig_id.strip()
            species_name = species_name.replace(' ', '_')
            contig_seq = seq_dict[contig_id]
            out_mags_dict[species_taxid].append(
                (f'>{species_name}|{species_taxid}|{taxid}|{contig_id}', contig_seq))
            out_magsize_dict[species_taxid] += len(contig_seq)

    for species_taxid, bin_contigs in out_mags_dict.items():
        out_mags = f'{out_mags_dir}/{species_taxid}.mags.fasta'
        with open(out_mags, 'w', encoding='utf-8') as fh:
            for header, seq in bin_contigs:
                fh.write(header + '\n')
                fh.write(seq + '\n')

    magsize_dict = dict(out_magsize_dict)
    with open(f"{out_mags_dir}/mags.size.json", 'w', encoding='utf-8') as fh:
        json.dump(magsize_dict, fh)

    pathlib.Path(f"{out_mags_dir}/mags.done").touch()
    return magsize_dict


runner()
