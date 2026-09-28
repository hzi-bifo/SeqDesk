#!/usr/bin/env python3
"""One command for the pipeline checks on elektra's single-node Slurm test kit (~/seqdesk-linux-test).

It starts the test Slurm and the E2E stack in SLURM mode, adds test hooks to the deployed FastQC workflow (a sleep and
a memory hog, switched by files), then runs the happy paths and the fault scenarios found in the SLURM and local
executor hunts, reading each run's state and card sentence through Compute's own services
(scripts/pipelines-check-driver.ts). At the end it restores compute.env, slurm.conf and the workflow, stops the stack,
Slurm and MySQL, and prints a PASS/FAIL table. Exit code 0 only when every scenario passed.

    python3 scripts/elektra-pipelines-check.py                      # everything
    python3 scripts/elektra-pipelines-check.py --only local-happy,slurm-cancel
    python3 scripts/elektra-pipelines-check.py --list
    python3 scripts/elektra-pipelines-check.py --attached           # drive over ssh from here (drops with the VPN)

By default the check runs detached ON elektra (a systemd --user unit, else nohup), so a dropped VPN does not stop it:
it prints the folder where the log and the results table land ($T/check-runs/<timestamp>/: check.log, results.txt,
exit-code), which you poll with ssh. `--status <folder>` prints the log tail and the table once it is there.

Needs: ssh access (ELEKTRA_SSH, default the kit's key and port), a deployed Compute build in e2e/compute (the kit's
git-archive sync), and the FASTQ QC study of the E2E lab. Only user space on elektra is touched.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time

SSH = os.environ.get("ELEKTRA_SSH", "ssh -o BatchMode=yes -i ~/Documents/Keys/aime_pmuench_key.txt -p 32244 pmuench@elektra.stat.uni-muenchen.de")
ANALYSIS = os.environ.get("ELEKTRA_ANALYSIS", "FASTQ QC: fastp, seqkit and a summary")
T = "~/seqdesk-linux-test"
WF = f"{T}/e2e/compute/.next/standalone/pipelines/fastqc/workflow/main.nf"
HOOKS = f"""    mkdir -p fastqc_raw fastqc_reports summary
    # CHECK HOOKS (scripts/elektra-pipelines-check.py; removed at the end)
    if [ -f \\\\$HOME/seqdesk-linux-test/e2e/check-sleep ]; then sleep \\\\$(cat \\\\$HOME/seqdesk-linux-test/e2e/check-sleep); fi
    if [ -f \\\\$HOME/seqdesk-linux-test/e2e/check-oom ]; then head -c 6G /dev/zero | tail > /dev/null; fi
"""
# Local share for the check: two runs fit at once (2 cores each of 4), a third waits.
LOCAL_ENV = "export SEQDESK_LOCAL_CORES=4 SEQDESK_LOCAL_RUN_CORES=2 SEQDESK_LOCAL_MEMORY_GB=24 SEQDESK_LOCAL_RUN_MEMORY_GB=8"


ON_HOST = os.environ.get("ELEKTRA_ON_HOST") == "1"  # set by --detach: the check runs on elektra itself


def sh(command, timeout=600, check=True):
    """Run a bash command on elektra (here when running on it); returns stdout."""
    full = ["bash", "-lc", command] if ON_HOST else SSH.split() + [f"bash -lc {shlex.quote(command)}"]
    result = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        raise RuntimeError(f"elektra: {command[:120]}… failed: {result.stderr.strip()[-400:]}")
    return result.stdout


def slurm(command, **kw):
    return sh(f"source {T}/slurm/env.sh >/dev/null; {command}", **kw)


def driver(*args, env=""):
    out = sh(f"source {T}/env.sh >/dev/null; cd {T}/e2e && source compute.env; {env + "; " if env else ""}cd compute && node --import tsx scripts/pipelines-check-driver.ts {' '.join(shlex.quote(a) for a in args)}", timeout=900)
    line = [l for l in out.strip().splitlines() if l.startswith("{")][-1]
    return json.loads(line)


def wait(run_id, done=lambda s: s["status"] in ("completed", "failed", "cancelled"), timeout=900, poll=10):
    until = time.time() + timeout
    last = None
    while time.time() < until:
        last = driver("status", run_id)
        if done(last):
            return last
        time.sleep(poll)
    return last


def hook(name, value=None):
    if value is None:
        sh(f"rm -f {T}/e2e/check-{name}")
    else:
        sh(f"echo {shlex.quote(str(value))} > {T}/e2e/check-{name}")


def wait_task(pattern="nf-RUN", timeout=300):
    until = time.time() + timeout
    while time.time() < until:
        if pattern in slurm("squeue -h -t R -o %j", check=False):
            return True
        time.sleep(3)
    return False


def jobs_named(part):
    return sum(1 for name in slurm("squeue -h -o %j", check=False).split() if part in name)


def local_procs(run_id):
    return int(sh(f"pgrep -u $(id -u) -f 'java.*{run_id[:8]}|runs/.*{run_id}' | wc -l", check=False).strip() or 0)


class Check:
    def __init__(self):
        self.rows = []

    def record(self, name, truth, shown, ok):
        self.rows.append((name, truth, shown, "PASS" if ok else "FAIL"))
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {shown}", flush=True)


# ------------------------------------------------------------------ scenarios

def local_happy(c, key):
    r = driver("start", key, "fastqc", "local", env=LOCAL_ENV)
    s = wait(r["runId"])
    c.record("local-happy", "exit 0", s["sentence"], s["status"] == "completed" and s["sentence"].startswith("Finished in"))


def local_oversubscribe(c, key):
    hook("sleep", 90)
    runs = [driver("start", key, "fastqc", "local", env=LOCAL_ENV) for _ in range(3)]
    time.sleep(15)
    third = driver("status", runs[2]["runId"])
    c.record("local-oversubscribe", "two run, the third waits", third["sentence"], third["status"] == "queued" and "Waiting for 2 cores and 8 GB on this server" in third["sentence"])
    ends = [wait(r["runId"], timeout=1200) for r in runs]
    c.record("local-oversubscribe-drain", "all three finish", ", ".join(e["status"] for e in ends), all(e["status"] == "completed" for e in ends))
    hook("sleep")


def local_cancel(c, key):
    hook("sleep", 300)
    r = driver("start", key, "fastqc", "local", env=LOCAL_ENV)
    time.sleep(45)
    driver("cancel", r["runId"])
    time.sleep(10)
    s = driver("status", r["runId"])
    left = local_procs(r["runId"])
    c.record("local-cancel", f"{left} processes left", s["sentence"], s["status"] == "cancelled" and left == 0)
    hook("sleep")


def local_timeout(c, key):
    hook("sleep", 240)
    r = driver("start", key, "fastqc", "local", env=f"{LOCAL_ENV} SEQDESK_LOCAL_RUN_TIME_HOURS=0.03")
    s = wait(r["runId"], timeout=600)
    c.record("local-timeout", "timeout 124", s["sentence"], s["status"] == "failed" and s["kind"] == "time")
    hook("sleep")


def local_oom(c, key):
    hook("oom", 1)
    r = driver("start", key, "fastqc", "local", env=f"{LOCAL_ENV} SEQDESK_LOCAL_RUN_MEMORY_GB=2")
    s = wait(r["runId"], timeout=600)
    limits = sh(f"grep -h '^Limits:' {T}/e2e/runs/*{r['runId']}/logs/pipeline.out", check=False).strip()
    ok = s["status"] == "failed" and (s["kind"] == "memory" or "none enforced" in limits)
    c.record("local-oom", limits or "no Limits line", f"{s['sentence']} ({s['kind']})", ok)
    hook("oom")


def local_restart(c, key):
    hook("sleep", 120)
    r = driver("start", key, "fastqc", "local", env=LOCAL_ENV)
    time.sleep(30)
    sh(f"cd {T}/e2e && ./stop.sh >/dev/null && ./start.sh >/dev/null")
    s = wait(r["runId"], timeout=900)
    c.record("local-stack-restart", "run survives the restart", s["sentence"], s["status"] == "completed")
    hook("sleep")


def slurm_happy(c, key):
    r = driver("start", key, "fastqc", "slurm")
    s = wait(r["runId"])
    c.record("slurm-happy", "COMPLETED", s["sentence"], s["status"] == "completed")


def slurm_cancel(c, key):
    hook("sleep", 300)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    time.sleep(10)
    driver("cancel", r["runId"])
    time.sleep(40)
    left = slurm("squeue -h | wc -l").strip()
    s = driver("status", r["runId"])
    c.record("slurm-cancel", f"{left} jobs left", s["sentence"], s["status"] == "cancelled" and left == "0")
    hook("sleep")


def slurm_scancel_head(c, key):
    hook("sleep", 300)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    time.sleep(10)
    slurm("scancel $(squeue -h -o '%i %j' | awk '/seqdesk-/{print $1}')")
    s = wait(r["runId"], timeout=300)
    left = slurm("squeue -h | wc -l").strip()
    c.record("slurm-scancel-head", f"{left} jobs left", s["sentence"], s["status"] == "cancelled" and left == "0")
    hook("sleep")


def slurm_scancel_child(c, key):
    hook("sleep", 300)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    time.sleep(10)
    slurm("scancel $(squeue -h -o '%i %j' | awk '/nf-RUN/{print $1}')")
    s = wait(r["runId"], timeout=400)
    c.record("slurm-scancel-child", "task job CANCELLED", s["sentence"], s["status"] == "failed" and "stopped outside SeqDesk" in s["sentence"])
    hook("sleep")


def slurm_timeout(c, key):
    hook("sleep", 150)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    driver("cancel", r["runId"])
    time.sleep(15)
    driver("resume", r["runId"], "1 min")
    s = wait(r["runId"], timeout=600)
    c.record("slurm-timeout", "task job exit 140", s["sentence"], s["status"] == "failed" and s["kind"] == "time" and "1 min" in s["sentence"])
    hook("sleep")


def slurm_oom(c, key):
    hook("oom", 1)
    r = driver("start", key, "fastqc", "slurm")
    s = wait(r["runId"], timeout=900)
    c.record("slurm-oom", "exceeded memory limit", s["sentence"], s["status"] == "failed" and s["kind"] == "memory")
    hook("oom")


def slurm_requeue(c, key):
    hook("sleep", 120)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    time.sleep(10)
    slurm("scontrol requeue $(squeue -h -o '%i %j' | awk '/seqdesk-/{print $1}')")
    s = wait(r["runId"], timeout=1200)
    c.record("slurm-requeue", "requeued, resumed", s["sentence"], s["status"] == "completed")
    hook("sleep")


def slurm_controller_down(c, key):
    hook("sleep", 60)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    sh(f"kill $(cat {T}/slurm/run/slurmctld.pid)")
    time.sleep(120)
    sh(f"{T}/slurm/start.sh >/dev/null 2>&1")
    s = wait(r["runId"], timeout=900)
    c.record("slurm-controller-down", "next task submit failed", s["sentence"], s["status"] in ("failed", "completed") and ("SLURM" in s["sentence"] or s["status"] == "completed"))
    hook("sleep")


def slurm_nextflow_kill(c, key):
    hook("sleep", 120)
    r = driver("start", key, "fastqc", "slurm")
    wait_task()
    sh(f"kill -9 $(pgrep -u $(id -u) -f 'java.*nextflow.*{r['runNumber']}' | head -1)")
    s = wait(r["runId"], timeout=400)
    c.record("slurm-nextflow-kill", "head job FAILED 9", s["sentence"], s["status"] == "failed" and "Nextflow itself was stopped" in s["sentence"])
    hook("sleep")


def slurm_maxjobs_inline(c, key):
    # SLURM lets this user run one job at a time: Nextflow's head job would wait forever for its own task jobs.
    # SeqDesk sees the limit at submit and runs the steps inside the one job, and says so on the card.
    slurm(f"sacctmgr -i modify user where name=$(id -un) set MaxJobs=1 >/dev/null")
    hook("sleep", 60)
    try:
        r = driver("start", key, "fastqc", "slurm")
        seen, children = "", 0
        until = time.time() + 240
        while time.time() < until:
            s = driver("status", r["runId"])
            seen = s["sentence"] if "one SLURM job" in s["sentence"] else seen
            children = max(children, jobs_named("nf-"))
            if s["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(10)
        s = wait(r["runId"], timeout=900)
        c.record("slurm-maxjobs-inline", f"MaxJobs=1, {children} task jobs", seen or s["sentence"], s["status"] == "completed" and children == 0 and "one SLURM job" in seen)
    finally:
        slurm("sacctmgr -i modify user where name=$(id -un) set MaxJobs=-1 >/dev/null", check=False)
        hook("sleep")


def parallel_studies(c, key):
    other = driver("other-target", key)
    if "targetKey" not in other:
        return c.record("parallel-studies", "no second study", other.get("error", "?"), False)
    driver("seed-copy", key, other["targetKey"])
    hook("sleep", 60)
    try:
        runs = [driver("start", key, "fastqc", "slurm"), driver("start", other["targetKey"], "fastqc", "slurm")]
        time.sleep(40)
        heads = str(jobs_named("seqdesk-"))
        ends = [wait(r["runId"], timeout=1200) for r in runs]
        c.record("parallel-studies", f"{heads} head jobs at once ({other['name']})", ", ".join(e["sentence"] for e in ends), all(e["status"] == "completed" for e in ends) and heads == "2")
    finally:
        hook("sleep")
        driver("unseed", other["targetKey"])


def resume_reads_changed(c, key):
    hook("sleep", 120)
    try:
        r = driver("start", key, "fastqc", "slurm")
        wait_task()
        driver("cancel", r["runId"])
        wait(r["runId"], timeout=300)
        driver("reads-add", key)
        s = driver("status", r["runId"])
        refused = driver("resume", r["runId"])
        hook("sleep")
        forced = driver("resume", r["runId"], "", "", "force")
        end = wait(r["runId"], timeout=900)
        ok = refused["status"] == 409 and refused["body"].get("code") == "reads_changed" and bool(s.get("readsChanged")) and forced["status"] < 300 and end["status"] == "completed"
        c.record("resume-reads-changed", f"409 {refused['body'].get('code')}; forced {forced['status']}", f"{s.get('readsChanged')} / {end['sentence']}", ok)
    finally:
        hook("sleep")
        driver("reads-drop", key)


SCENARIOS = {f.__name__.replace("_", "-"): f for f in [
    local_happy, local_oversubscribe, local_cancel, local_timeout, local_oom, local_restart,
    slurm_happy, slurm_cancel, slurm_scancel_head, slurm_scancel_child, slurm_timeout, slurm_oom, slurm_requeue,
    slurm_controller_down, slurm_nextflow_kill, slurm_maxjobs_inline, parallel_studies, resume_reads_changed]}


# ------------------------------------------------------------------ setup and teardown

def setup():
    sh(f"cd {T}/e2e && [ -f compute.env.check-bak ] || cp compute.env compute.env.check-bak; cat compute.env.check-bak compute.env.slurm > compute.env; echo '{LOCAL_ENV}' >> compute.env")
    sh(f"C={T}/slurm/etc/slurm.conf; [ -f $C.check-bak ] || cp $C $C.check-bak; grep -q OverMemoryKill $C || printf 'JobAcctGatherParams=OverMemoryKill\\nJobAcctGatherFrequency=task=5\\n' >> $C")
    sh(f"[ -f {WF}.check-bak ] || cp {WF} {WF}.check-bak")
    sh(f"python3 - <<'PY'\nimport os\np=os.path.expanduser('{WF}')\ns=open(p).read()\nif 'CHECK HOOKS' not in s:\n    s=s.replace('    mkdir -p fastqc_raw fastqc_reports summary\\n', '''{HOOKS}''', 1)\n    open(p,'w').write(s)\nPY")
    sh(f"{T}/slurm/start.sh >/dev/null 2>&1; cd {T}/e2e && ./start.sh >/dev/null", timeout=300)


def teardown():
    steps = [
        f"cd {T}/e2e && ./stop.sh --pg >/dev/null 2>&1 || true",
        f"source {T}/slurm/env.sh >/dev/null 2>&1; scancel -u $(id -un) >/dev/null 2>&1 || true; {T}/slurm/stop.sh >/dev/null 2>&1 || true",
        f"cd {T}/e2e && [ -f compute.env.check-bak ] && mv compute.env.check-bak compute.env || true",
        f"C={T}/slurm/etc/slurm.conf; [ -f $C.check-bak ] && mv $C.check-bak $C || true",
        f"[ -f {WF}.check-bak ] && mv {WF}.check-bak {WF} || true",
        f"rm -f {T}/e2e/check-sleep {T}/e2e/check-oom",
        f"source {T}/slurm/env.sh >/dev/null 2>&1; sacctmgr -i modify user where name=$(id -un) set MaxJobs=-1 >/dev/null 2>&1 || true",
    ]
    for step in steps:
        try:
            sh(step, timeout=180, check=False)
        except Exception as error:  # keep restoring the rest
            print(f"teardown: {error}", file=sys.stderr)


def detach(argv):
    """Copy this script to elektra and start it there as its own unit; print where the results land."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    folder = f"{T}/check-runs/{stamp}"
    here = os.path.abspath(__file__)
    subprocess.run(SSH.split() + [f"mkdir -p {folder}"], check=True, timeout=60)
    with open(here, "rb") as source:
        subprocess.run(SSH.split() + [f"cat > {folder}/check.py"], stdin=source, check=True, timeout=120)
    args = " ".join(shlex.quote(a) for a in argv)
    inner = f"cd {folder} && ELEKTRA_ON_HOST=1 python3 -u check.py --attached {args} > check.log 2>&1; echo $? > exit-code"
    # KillMode=process: the stack the check starts must not die with the unit mid-teardown; teardown stops it.
    start = (f"systemd-run --user --unit=seqdesk-check-{stamp} -p KillMode=process --collect bash -lc {shlex.quote(inner)} 2>/dev/null"
             f" || (nohup setsid bash -lc {shlex.quote(inner)} >/dev/null 2>&1 &)")
    subprocess.run(SSH.split() + [start], check=True, timeout=60)
    print(f"started on elektra: {folder}\npoll:   python3 scripts/elektra-pipelines-check.py --status {folder}")
    return 0


def status(folder):
    out = subprocess.run(SSH.split() + [f"tail -n 25 {folder}/check.log; echo ---; cat {folder}/results.txt 2>/dev/null; cat {folder}/exit-code 2>/dev/null"], capture_output=True, text=True, timeout=60)
    print(out.stdout or out.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated scenario names")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--attached", action="store_true", help="run here, driving elektra over ssh (or on elektra itself)")
    parser.add_argument("--status", metavar="FOLDER", help="show a detached check's log tail and results")
    a = parser.parse_args()
    if a.list:
        print("\n".join(SCENARIOS))
        return 0
    if a.status:
        return status(a.status)
    if not a.attached and not ON_HOST:
        return detach(sys.argv[1:])
    names = a.only.split(",") if a.only else list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        parser.error(f"unknown scenarios: {', '.join(unknown)}")
    c = Check()
    try:
        print("setting up elektra…", flush=True)
        setup()
        key = driver("target", ANALYSIS)["targetKey"]
        for name in names:
            print(f"{name}…", flush=True)
            try:
                SCENARIOS[name](c, key)
            except Exception as error:
                c.record(name, "error", str(error)[:200], False)
            finally:
                slurm("scancel -u $(id -un) >/dev/null 2>&1 || true", check=False)
                hook("sleep")
                hook("oom")
    finally:
        print("restoring elektra…", flush=True)
        teardown()
    width = max(len(r[0]) for r in c.rows) if c.rows else 10
    print("\n" + f"{'scenario':<{width}}  result  truth / card")
    for name, truth, shown, result in c.rows:
        print(f"{name:<{width}}  {result:<6}  {truth} / {shown}")
    failed = [r for r in c.rows if r[3] != "PASS"]
    print(f"\n{len(c.rows) - len(failed)} of {len(c.rows)} passed")
    if ON_HOST:
        with open("results.txt", "w") as table:
            table.write("\n".join(f"{n}\t{r}\t{t}\t{sh_}" for n, t, sh_, r in c.rows) + f"\n{len(c.rows) - len(failed)} of {len(c.rows)} passed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
