import { describe, expect, it } from "vitest";
import { generateLocalRunScript, generateSlurmRunScript, shellQuote } from "./run-script";

const base = {
  runId: "clrun1",
  runFolder: "/data/pipeline_runs/explore/EXP-20260904-001--id-clrun1",
  language: "python" as const,
  entrypoint: "analysis.py",
  environmentPrefix: "/net/conda/explore-environments/seqdesk-explore-python-abc",
  condaPath: "/opt/conda",
  helperLibDir: "/srv/seqdesk/explore/lib",
};

describe("explore run scripts", () => {
  it("writes the exit marker, isolates secrets and uses the environment prefix", () => {
    const script = generateLocalRunScript(base);
    expect(script).toContain("Pipeline completed with exit code: $EXIT_CODE");
    expect(script).toContain('export PATH="$ENV_PREFIX/bin:$PATH"');
    expect(script).toContain("unset DATABASE_URL DIRECT_URL ANTHROPIC_API_KEY NEXTAUTH_SECRET");
    expect(script).toContain('python analysis.py --run-dir "$RUN_DIR"');
    expect(script).toContain("PYTHONPATH=\"$HELPER_LIB/python");
    expect(script).toContain("logs/pipeline.out");
  });

  it("uses Rscript for R analyses", () => {
    expect(generateLocalRunScript({ ...base, language: "r", entrypoint: "analysis.R" })).toContain('Rscript analysis.R --run-dir "$RUN_DIR"');
  });

  it("writes an sbatch header with hour-based time limit and sanitized options", () => {
    const script = generateSlurmRunScript({
      ...base,
      slurm: { slurmQueue: "cpu", slurmCores: 4, slurmMemory: "32GB", slurmTimeLimit: 2, slurmOptions: "--job-name=evil --gres=gpu:1" },
    });
    expect(script).toContain("#SBATCH -t 2:0:0");
    expect(script).toContain("#SBATCH -c 4");
    expect(script).toContain("#SBATCH --mem='32GB'");
    expect(script).toContain("#SBATCH --job-name=seqdesk-clrun1");
    expect(script).toContain("#SBATCH --gres=gpu:1");
    expect(script).not.toContain("evil");
    expect(script).toContain("copy_slurm_logs; exit $EXIT_CODE");
  });

  it("falls back to safe defaults for malformed scheduler settings", () => {
    const script = generateSlurmRunScript({
      ...base,
      slurm: { slurmQueue: "bad queue;rm", slurmCores: -1, slurmMemory: "lots", slurmTimeLimit: 0.5, slurmOptions: "a\nb" },
    });
    expect(script).toContain("#SBATCH -p cpu");
    expect(script).toContain("#SBATCH -c 2");
    expect(script).toContain("#SBATCH --mem='16GB'");
    expect(script).toContain("#SBATCH -t 4:0:0");
    expect(script).not.toContain("#SBATCH a");
  });

  it("refuses run folders that could break out of the script", () => {
    expect(() => generateLocalRunScript({ ...base, runFolder: "/tmp/x'; rm -rf /" })).toThrow(/unsupported/);
    expect(() => generateLocalRunScript({ ...base, runFolder: "relative/path" })).toThrow(/unsupported/);
  });

  it("shell-quotes unusual values", () => {
    expect(shellQuote("plain-value_1")).toBe("plain-value_1");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
