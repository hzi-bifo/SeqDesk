import { describe, expect, it } from "vitest";
import { buildMountPlan, carveOutDenies, carveOutListingDirs, describeMountPlan, mountPlanHash, renderBwrapArgs, renderSeatbeltProfile, validateMountPlan, type MountPlanInput } from "./mount-plan";

const base: MountPlanInput = {
  platform: "linux",
  runFolder: "/data/explore/runs/EXP-1--id-run1",
  environmentPrefix: "/data/explore/environments/seqdesk-explore-python",
  condaPackageDirs: ["/opt/conda/pkgs"],
  roots: { runsRoot: "/data/explore/runs", datasetsRoot: "/data/explore/datasets", exploreBase: "/data/explore", appDir: "/srv/seqdesk", hostHome: "/home/seqdesk", tmpRoot: "/tmp" },
  host: { system: { "/usr": { exists: true }, "/etc": { exists: true }, "/bin": { symlink: "usr/bin" }, "/lib": { symlink: "usr/lib" }, "/lib64": { symlink: "usr/lib64" } }, sss: true },
};

describe("mount plans", () => {
  it("allows only the run folder to be written and hides everything else", () => {
    const plan = buildMountPlan(base);
    const summary = describeMountPlan(plan);
    expect(summary.writable).toEqual(["/data/explore/runs/EXP-1--id-run1"]);
    expect(summary.readable).toEqual(expect.arrayContaining(["/usr", "/etc", "/data/explore/environments/seqdesk-explore-python", "/opt/conda/pkgs", "/var/lib/sss"]));
    expect(summary.readable).not.toContain("/data/explore/datasets");
    expect(plan.tmpfs).toEqual(expect.arrayContaining(["/home", "/root", "/tmp", "/opt"]));
    expect(plan.network).toBe("none");
    expect(plan.namespaces).toContain("net");
    expect(plan.home).toBe("/data/explore/runs/EXP-1--id-run1/home");
  });

  it("hides the plan files and keeps the log read-only inside a Linux sandbox", () => {
    const args = renderBwrapArgs(buildMountPlan(base));
    const run = "/data/explore/runs/EXP-1--id-run1";
    expect(args).toContain(`${run}/control`);
    expect(args[args.indexOf(`${run}/control`) - 1]).toBe("--tmpfs");
    const script = args.indexOf(`${run}/control/analysis.sh`);
    expect(args[script - 1]).toBe("--ro-bind");
    expect(args.indexOf(`${run}/control`)).toBeGreaterThan(args.indexOf("--bind"));
    expect(args.indexOf(`${run}/control`)).toBeLessThan(script);
    const logs = args.indexOf(`${run}/logs`);
    expect(args[logs - 1]).toBe("--ro-bind");
    expect(logs).toBeGreaterThan(args.indexOf("--bind"));
  });

  it("renders bubblewrap arguments in mount order with the namespaces unshared", () => {
    const args = renderBwrapArgs(buildMountPlan(base));
    expect(args.slice(0, 8)).toEqual(["--unshare-user-try", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net", "--die-with-parent", "--new-session"]);
    expect(args).toContain("--symlink");
    expect(args.indexOf("--tmpfs")).toBeGreaterThan(args.indexOf("--proc"));
    const bind = args.indexOf("--bind");
    expect(args.slice(bind, bind + 3)).toEqual(["--bind", "/data/explore/runs/EXP-1--id-run1", "/data/explore/runs/EXP-1--id-run1"]);
    expect(args.slice(-2)).toEqual(["--chdir", "/data/explore/runs/EXP-1--id-run1"]);
    expect(args).not.toContain("/data/explore/datasets");
  });

  it("keeps the network when asked and drops the net namespace", () => {
    const plan = buildMountPlan({ ...base, network: "host" });
    expect(plan.namespaces).not.toContain("net");
    expect(renderBwrapArgs(plan)).not.toContain("--unshare-net");
  });

  it("refuses plans that reach other runs, the tables or the app", () => {
    const plan = buildMountPlan(base);
    expect(() => validateMountPlan({ ...plan, binds: [...plan.binds, { src: "/data/explore/runs/EXP-2--id-run2", dst: "/data/explore/runs/EXP-2--id-run2", mode: "ro", purpose: "extra" }] }, { runFolder: base.runFolder, runsRoot: "/data/explore/runs" })).toThrow(/another run/);
    expect(() => validateMountPlan({ ...plan, binds: [...plan.binds, { src: "/data/explore/datasets", dst: "/data/explore/datasets", mode: "ro", purpose: "extra" }] }, { runFolder: base.runFolder, datasetsRoot: "/data/explore/datasets" })).toThrow(/tables storage/);
    expect(() => validateMountPlan({ ...plan, binds: [{ src: "/srv/seqdesk", dst: "/srv/seqdesk", mode: "rw", purpose: "run" }] }, { runFolder: base.runFolder, appDir: "/srv/seqdesk" })).toThrow(/outside the run folder/);
    expect(() => buildMountPlan({ ...base, runFolder: "relative" })).toThrow(/absolute/);
    expect(() => buildMountPlan({ ...base, extraReadOnly: ["/srv/seqdesk/.env"] })).toThrow(/application directory/);
    expect(buildMountPlan({ ...base, runFolder: "/srv/seqdesk/work/explore/runs/EXP-1--id-run1", roots: { ...base.roots, runsRoot: "/srv/seqdesk/work/explore/runs" } }).binds.some((bind) => bind.mode === "rw")).toBe(true);
  });

  it("renders a Seatbelt profile that denies the carved-out roots and every write outside the run", () => {
    const plan = buildMountPlan({ ...base, platform: "darwin", realPaths: { "/tmp": "/private/tmp" } });
    expect(plan.denyRoots).toEqual(["/data/explore/runs", "/data/explore/datasets", "/data/explore", "/srv/seqdesk", "/home/seqdesk"]);
    plan.denyRead = carveOutDenies("/data/explore", ["/data/explore/runs/EXP-1--id-run1", "/data/explore/environments/seqdesk-explore-python"], (dir) => {
      if (dir === "/data/explore") return ["runs", "datasets", "environments", "imports"];
      if (dir === "/data/explore/runs") return ["EXP-1--id-run1", "EXP-2--id-run2"];
      if (dir === "/data/explore/environments") return ["seqdesk-explore-python", "seqdesk-explore-r"];
      return null;
    });
    expect([...plan.denyRead].sort()).toEqual(["/data/explore/datasets", "/data/explore/environments/seqdesk-explore-r", "/data/explore/imports", "/data/explore/runs/EXP-2--id-run2"]);
    const allowed = ["/data/explore/runs/EXP-1--id-run1", "/data/explore/runs/EXP-1--id-run1/control", "/data/explore/environments/seqdesk-explore-python"];
    expect(carveOutListingDirs("/data/explore", allowed).sort()).toEqual(["/data/explore", "/data/explore/environments", "/data/explore/runs"]);
    plan.denyListing = carveOutListingDirs("/data/explore", allowed, [plan.chdir]);
    expect(plan.denyListing.sort()).toEqual(["/data/explore/environments"]);
    const profile = renderSeatbeltProfile(plan);
    expect(profile).toContain('(deny file-read-data (literal "/data/explore/environments"))');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(deny file-read* (subpath "/data/explore/datasets")');
    expect(profile).toMatch(/\(allow file-read\*[^\n]*\(subpath "\/data\/explore\/runs\/EXP-1--id-run1"\)/);
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(allow file-write* (literal "/dev/null") (subpath "/data/explore/runs/EXP-1--id-run1"))');
    expect(profile).toContain('(deny file-write* (subpath "/data/explore/runs/EXP-1--id-run1/control") (subpath "/data/explore/runs/EXP-1--id-run1/logs"))');
    expect(profile).toContain('(deny file-read* (subpath "/data/explore/runs/EXP-1--id-run1/control"))');
    expect(profile).toContain('(allow file-read* (literal "/data/explore/runs/EXP-1--id-run1/control/analysis.sh"))');
  });

  it("denies a whole root when nothing under it is allowed and directories that cannot be listed", () => {
    expect(carveOutDenies("/private", ["/elsewhere"], () => null)).toEqual(["/private"]);
    expect(carveOutDenies("/a", ["/a/b/c"], (dir) => (dir === "/a" ? ["b", "x"] : null)).sort()).toEqual(["/a/b", "/a/x"]);
  });

  it("hashes deterministically", () => {
    expect(mountPlanHash(buildMountPlan(base))).toBe(mountPlanHash(buildMountPlan({ ...base })));
    expect(mountPlanHash(buildMountPlan(base))).not.toBe(mountPlanHash(buildMountPlan({ ...base, network: "host" })));
  });
});
