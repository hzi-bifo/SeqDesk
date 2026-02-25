import pandas as pd
import numpy as np
import os
import rich_click as click
import json
import pickle

''' Use learned model by Kover 2.0 for prediction. 
Model learned using Kover 2.0 : https://github.com/aldro61/kover [Alexandre Drouin, Gaël Letarte, Frédéric Raymond, Mario Marchand, Jacques Corbeil, and François
Laviolette. Interpretable genotype-to-phenotype classifiers with performance guarantees. Scientific reports, 9(1):1–13, 2019]
We encoded model based on Kover's output for prediction using python. Contact us for the encoding scripts. 
One time one sample.
'''


@click.command()
# @click.option('-sample', '--sample_name', type=str,
#               help='Sample name.')
@click.option("-s", "--species", default='Escherichia_coli',
              type=str,
              help='Species to predict.')
@click.option('-wd', '--work_dir', type=str, required=True,
              help='Working directory.')
@click.option('-sd', '--software_dir', type=str, default='', required=True,
              help='Software directory. if not provided, we assume you work in the software directory.')
@click.option('-a', '--all_abt', is_flag=True,
              help='All the possible antibiotics w.r.t. the species.')
@click.option('-o', '--out_prefix', type=str,
              help='Output prefix.')
def predictor(species, work_dir, software_dir, all_abt, out_prefix):
    if all_abt:
        # if species=='Escherichia_coli':
        #     anti_list=['amoxicillin', 'amoxicillin/clavulanic acid', 'aztreonam','ceftazidime',	'ceftriaxone','cefuroxime',
        #                'ciprofloxacin','gentamicin']
        #     # anti_list=['ampicillin','cefotaxime','piperacillin/tazobactam','tetracycline','trimethoprim']
        #     dic_cl={'amoxicillin': 'scm', 'amoxicillin/clavulanic acid': 'scm', 'aztreonam': 'tree', 'ceftazidime': 'tree',
        #             'ceftriaxone': 'tree', 'cefuroxime': 'scm', 'ciprofloxacin': 'tree', 'gentamicin': 'scm'}
        #
        # elif species=='Staphylococcus_aureus':
        #     anti_list=['ciprofloxacin' ,'clindamycin', 'erythromycin', 'fusidic acid', 'gentamicin', 'penicillin','tetracycline']
        #     dic_cl={'ciprofloxacin': 'scm', 'clindamycin': 'scm', 'erythromycin': 'scm', 'fusidic acid': 'tree',
        #             'gentamicin': 'scm', 'penicillin': 'scm','tetracycline':'tree'}
        # if species in ["Escherichia_coli","Staphylococcus_aureus","Klebsiella_pneumoniae","Pseudomonas_aeruginosa"]:
        # dic_cl=np.load(software_path+'/log/temp/'+species+'/Dict_'+species+'_classifier.npy',allow_pickle='TRUE').item()
        
        model_dir = software_dir + '/models/'
        supported_species_list = os.listdir(model_dir)
        
        # if species in ["Escherichia_coli", "Staphylococcus_aureus",
        #                "Klebsiella_pneumoniae", "Pseudomonas_aeruginosa"]:
        if species in supported_species_list:
            f = open(model_dir + species +
                    '/Dict_' + species + '_classifier.json', 'r', encoding='utf-8')
            dic_cl = json.load(f)
            abt_list = list(dic_cl.keys())
            f.close()

        else:
            raise RuntimeError('Species not supported')
    else:
        raise RuntimeError('Only possible to run for all antibiotics')

    kmer_profile = work_dir.rstrip(
        '/') + '/kover/temp/kmer_lists/' + species + '.txt'

    kmer_df = pd.read_csv(kmer_profile, names=['combination', 'count'], dtype={
        'genome_id': object}, sep=" ")
    kmer_list = kmer_df['combination'].to_list()

    # test_file = work_path + "/log/temp/K-mer_lists/" + SampleName + ".txt"

    # kmer_P_df= pd.read_csv(test_file,
    #                     names=['combination', 'count'],dtype={'genome_id': object}, sep="\t")
    # kmer_P_df = pd.read_csv(test_file, names=['combination', 'count'], dtype={
    #                         'genome_id': object}, sep=" ")
    # kmer_P_df=  pd.read_hdf(test_file)
    # print(kmer_P_df)
    # kmer_P = kmer_P_df['combination'].to_list()

    pheno_table = pd.DataFrame(index=abt_list, columns=['Phenotype'])

    # fileDir = os.path.dirname(os.path.realpath('__file__'))
    for abt in abt_list:

        chosen_cl = dic_cl[abt]
        meta_dir = model_dir + species + '/' + \
            str(abt.translate(str.maketrans(
                {'/': '_', ' ': '_', '+': '_'}))) + '_temp/' + chosen_cl + '_b_0'
        # ==============
        #  1
        # ==============
        if chosen_cl == 'scm':
            with open(meta_dir + '/results.json', 'r', encoding='utf-8') as f:
                data = json.load(f)
            # model_type=data["cv"]["best_hp"]["values"]["model_type"]
            # model_node=data["model"]["rules"]
            # rule_ap=[i.split('(')[0] for i in model_node]
            # marker=[i.split('(')[1][:-1] for i in model_node]
            model_rules = data["model"]["rules"]
            model_type = data["cv"]["best_hp"]["values"]["model_type"]
            # _rule_importances = data["model"]["rule_importances"]
            rule_binary_list = []
            for rule in model_rules:
                if rule.startswith("Presence"):
                    kmer = rule.replace("Presence(", "").replace(")", "")
                    rule_binary_list.append(kmer in kmer_list)
                else:
                    kmer = rule.replace("Absence(", "").replace(")", "")
                    rule_binary_list.append(kmer not in kmer_list)

            check_func = any if model_type == "disjunction" else all
            pheno_table.loc[abt, 'Phenotype'] = 1 if check_func(
                rule_binary_list) else 0
            # if model_type == "disjunction":
            #     check_func = any
            # elif model_type == "conjunction":
            #     check_func = all
            # else:
            #     print('error 1.')
            # pheno_table.loc[abt, 'Phenotype'] = 1 if check_func(
            #     rule_binary_list) else 0

            # if model_type=="disjunction": # OR
            #     Phenotype=0
            #     for i_seq,f_ap in zip(marker,rule_ap):
            #         if any([(i_seq in kmer_P) and f_ap=='Presence',(i_seq not in kmer_P) and f_ap=='Absence']):
            #             Phenotype=1
            #
            # elif model_type=="conjunction": #AND
            #     Phenotype=1
            #     for i_seq,f_ap in zip(marker,rule_ap):
            #         if any([(i_seq not in kmer_P) and f_ap=='Presence',(i_seq in kmer_P) and f_ap=='Absence']):
            #             Phenotype=0
            #
            # else:
            #     print('error 1.')

            # pheno_table.loc[anti,'Phenotype']=Phenotype

        # ==============
        #     2
        # ==============
        # Greedy
        elif chosen_cl == 'tree':
            loaded_model = pickle.load(
                open(meta_dir + '_finalized_model.sav', 'rb'))
            [path_id, _node_marker, dic_pheno, dic_node_lf,
                dic_node_rf, dic_node_marker] = loaded_model

            current = path_id[0][0]  # the main parent node. Start from here!
            # print(current)
            f_pa = []
            while 'leaf' not in current:
                if dic_node_marker[current] in kmer_list:
                    f_pa.append('l')
                    current = dic_node_lf[current]
                else:
                    f_pa.append('r')
                    current = dic_node_rf[current]

            # Phenotype = dic_pheno[tuple(f_pa)]
            pheno_table.loc[abt, 'Phenotype'] = dic_pheno[tuple(f_pa)] #Phenotype
        # print(Phenotype)

    print(pheno_table)
    pheno_table.to_csv(out_prefix + '_result.txt', sep="\t")


predictor()