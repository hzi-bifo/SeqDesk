import { describe, expect, it } from "vitest";
import {
  buildCondaRunArgs,
  DEFAULT_PIPELINE_CONDA_ENV,
  resolveCondaEnvironmentReference,
} from "./conda-environment";

describe("conda environment references", () => {
  it("uses the default named environment", () => {
    expect(resolveCondaEnvironmentReference()).toEqual({
      value: DEFAULT_PIPELINE_CONDA_ENV,
      kind: "name",
      selector: "-n",
    });
  });

  it("uses -n for a configured environment name", () => {
    expect(buildCondaRunArgs("reviewer-env", ["nextflow", "-version"])).toEqual(
      ["run", "-n", "reviewer-env", "nextflow", "-version"]
    );
  });

  it.each([
    "/shared/conda/envs/seqdesk",
    "./.conda/seqdesk",
    "../shared/seqdesk",
    "shared/conda/seqdesk",
    "C:\\seqdesk\\conda-env",
  ])("uses -p for the environment prefix %s", (environment) => {
    expect(
      buildCondaRunArgs(environment, ["java", "-version"])
    ).toEqual(["run", "-p", environment, "java", "-version"]);
  });
});
