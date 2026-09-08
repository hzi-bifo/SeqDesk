"""Internal contract fixtures, NOT external-service responses or benchmark evidence."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parents[3]
opal = load(Path(__file__).with_name("run_opal.py"), "opal_runner")
metaphlan = load(ROOT / "metaphlan/workflow/bin/run_metaphlan.py", "metaphlan_runner")


def profile(sample="truth-0", value="100", taxon="2", lineage="2"):
    return ("@SampleID:" + sample + "\n@Version:0.10.0\n@Ranks:superkingdom|phylum|class|order|family|genus|species\n"
            "@@TAXID\tRANK\tTAXPATH\tTAXPATHSN\tPERCENTAGE\n" + taxon + "\tsuperkingdom\t" + lineage + "\tBacteria\t" + value + "\n")


class TaxonomicContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = Path.cwd()
        os.chdir(self.temp.name)
        Path("samples.csv").write_text("sample_id\nsample_0\n")
        Path("truth.profile").write_text(profile() + "\n" + profile("truth-extra"))
        self.add_prediction("run-1")
        self.request = {"input": "samples.csv", "profiles_dir": "profiles", "ground_truth": "truth.profile",
                        "sample_map": '{"sample_0":"truth-0"}', "taxonomy_note": "Internal test fixture only",
                        "taxonomy_confirmed": True, "normalize": False}

    def tearDown(self):
        os.chdir(self.previous)
        self.temp.cleanup()

    def add_prediction(self, run):
        directory = Path("profiles/metaphlan") / run / "artifact-1"
        directory.mkdir(parents=True)
        (directory / "sample_0.cami.profile").write_text(profile("sample_0"))
        (directory / "sample_0.provenance.json").write_text(json.dumps({"sampleId": "sample_0",
            "databaseIndex": "mpa_fixture", "databaseMetadataSha256": "0" * 64}))
        return directory

    def test_exact_subset_and_provenance(self):
        command = opal.prepare(self.request)
        self.assertEqual(command[0], "opal.py")
        self.assertNotIn("--normalize", command)
        self.assertEqual(set(opal.read_profile("benchmark-inputs/ground-truth.profile")), {"truth-0"})
        self.assertEqual(set(opal.read_profile("benchmark-inputs/prediction-1.profile")), {"truth-0"})
        provenance = json.loads(Path("benchmark-provenance.json").read_text())
        self.assertEqual(provenance["referenceSamplesExcluded"], ["truth-extra"])
        self.assertEqual(len(provenance["groundTruthSha256"]), 64)
        self.assertEqual(provenance["predictionArtifacts"][0]["profilingProvenance"]["databaseIndex"], "mpa_fixture")

    def test_normalization_is_explicit(self):
        self.assertIn("--normalize", opal.prepare({**self.request, "normalize": True}))

    def test_requires_reference_confirmation(self):
        with self.assertRaisesRegex(ValueError, "Confirm"):
            opal.prepare({**self.request, "taxonomy_confirmed": False})

    def test_mapping_cannot_omit_samples(self):
        with self.assertRaisesRegex(ValueError, "every selected"):
            opal.prepare({**self.request, "sample_map": "{}"})

    def test_mapping_cannot_invent_reference_sample(self):
        with self.assertRaisesRegex(ValueError, "absent"):
            opal.prepare({**self.request, "sample_map": '{"sample_0":"wrong-dataset"}'})

    def test_duplicate_study_codes(self):
        Path("samples.csv").write_text("sample_id\nsample_0\nsample_0\n")
        with self.assertRaisesRegex(ValueError, "unique"):
            opal.prepare(self.request)

    def test_many_to_one_mapping(self):
        Path("samples.csv").write_text("sample_id\nsample_0\nsample_1\n")
        with self.assertRaisesRegex(ValueError, "same Ground Truth"):
            opal.prepare({**self.request, "sample_map": '{"sample_0":"truth-0","sample_1":"truth-0"}'})

    def test_multiple_runs_require_selection(self):
        self.add_prediction("run-2")
        with self.assertRaisesRegex(ValueError, "explicit prediction run"):
            opal.prepare(self.request)
        command = opal.prepare({**self.request, "prediction_run_ids": "run-1,run-2"})
        self.assertIn("benchmark-inputs/prediction-2.profile", command)

    def test_missing_requested_run(self):
        with self.assertRaisesRegex(ValueError, "same-study"):
            opal.prepare({**self.request, "prediction_run_ids": "unrelated-run"})

    def test_incomplete_run(self):
        Path("samples.csv").write_text("sample_id\nsample_0\nsample_1\n")
        with self.assertRaisesRegex(ValueError, "does not cover"):
            opal.prepare({**self.request, "sample_map": '{"sample_0":"truth-0","sample_1":"truth-extra"}'})

    def test_rejects_duplicate_prediction(self):
        directory = Path("profiles/metaphlan/run-1/duplicate")
        directory.mkdir()
        (directory / "sample_0.cami.profile").write_text(profile("sample_0"))
        with self.assertRaisesRegex(ValueError, "duplicate prediction"):
            opal.prepare(self.request)

    def test_requires_database_provenance(self):
        Path("profiles/metaphlan/run-1/artifact-1/sample_0.provenance.json").unlink()
        with self.assertRaisesRegex(ValueError, "database provenance"):
            opal.prepare(self.request)

    def test_rejects_non_taxonomic_and_invalid_profiles(self):
        for content in ("read\tgenome\n", profile(value="NaN"), profile(value="-1"), profile(value="101"),
                        profile(taxon="SGB123"), profile(taxon="3", lineage="2"), profile() + profile()):
            with self.subTest(content=content):
                Path("bad.profile").write_text(content)
                with self.assertRaises(ValueError):
                    opal.read_profile("bad.profile")

    def test_duplicate_taxon(self):
        Path("bad.profile").write_text(profile() + "2\tsuperkingdom\t2\tBacteria\t0\n")
        with self.assertRaisesRegex(ValueError, "Duplicate taxon"):
            opal.read_profile("bad.profile")

    def test_cami_strain_suffixes_are_explicitly_excluded_from_species_benchmark(self):
        Path("strain.profile").write_text(profile() + "32644.6\tstrain\t||||||32644|32644.6\tunidentified\t50\n")
        parsed = opal.read_profile("strain.profile")
        opal.write_profile("selected.profile", parsed)
        self.assertNotIn("32644.6", Path("selected.profile").read_text())
        self.assertNotIn("|strain", Path("selected.profile").read_text())

    def test_metaphlan_uses_offline_pinned_tool_and_reuses_mapping(self):
        request = {"sample_id": "sample_0", "db_dir": "/db/with spaces", "db_index": "mpa_fixture", "cpus": 4}
        commands = metaphlan.commands(request, ["input_R1.fastq.gz", "input_R2.fastq.gz"])
        self.assertIn("--offline", commands[0])
        self.assertEqual(commands[1][1], "mapping.bz2")
        self.assertEqual(commands[1][commands[1].index("--mapout") + 1], "unused-export-mapout.bz2")
        self.assertNotIn("--force", commands[1])
        self.assertIn("--CAMI_format_output", commands[1])
        self.assertIn("/db/with spaces", commands[0])
        self.assertNotIn("--install", commands[0])

    def test_strain_only_profile_cannot_produce_empty_benchmark_input(self):
        Path("strain.profile").write_text(profile().rsplit("\n", 2)[0] + "\n32644.6\tstrain\t||||||32644|32644.6\tunidentified\t100\n")
        parsed = opal.read_profile("strain.profile")
        with self.assertRaisesRegex(ValueError, "evaluated ranks"):
            opal.write_profile("selected.profile", parsed)

    def test_metaphlan_rejects_unsafe_sample_and_latest_database(self):
        with self.assertRaisesRegex(ValueError, "sample code"):
            metaphlan.validate_request({"sample_id": "../escape"})
        with self.assertRaisesRegex(ValueError, "exact installed"):
            metaphlan.validate_request({"sample_id": "sample_0", "db_index": "latest"})

    def test_metaphlan_missing_database_never_downloads(self):
        with self.assertRaisesRegex(ValueError, "metadata is missing"):
            metaphlan.validate_request({"sample_id": "sample_0", "db_index": "mpa_missing", "db_dir": self.temp.name})

    def test_metaphlan_requires_large_index_files_for_pinned_version(self):
        Path("mpa_fixture.pkl").write_text("internal fixture only")
        for suffix in ("1", "2", "3", "4", "rev.1", "rev.2"):
            Path("mpa_fixture." + suffix + ".bt2").write_text("internal fixture only")
        with self.assertRaisesRegex(ValueError, "bt2l"):
            metaphlan.validate_request({"sample_id": "sample_0", "db_index": "mpa_fixture", "db_dir": self.temp.name})


if __name__ == "__main__":
    unittest.main()
