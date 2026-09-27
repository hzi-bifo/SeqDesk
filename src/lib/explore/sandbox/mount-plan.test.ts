import { describe, expect, it } from "vitest";
import { buildMountPlan, DARWIN_DESCRIPTOR_PATHS, DARWIN_SYSTEM_READ, describeMountPlan, mountPlanHash, renderBwrapArgs, renderSeatbeltProfile, syntheticIdentityFiles, traverseDirs, validateMountPlan, type MountPlanInput } from "./mount-plan";

const base: MountPlanInput = {
  platform: "linux",
  runFolder: "/data/explore/runs/EXP-1--id-run1",
  environmentPrefix: "/data/explore/environments/seqdesk-explore-python",
  condaPackageDirs: ["/opt/conda/pkgs"],
  roots: { runsRoot: "/data/explore/runs", datasetsRoot: "/data/explore/datasets", exploreBase: "/data/explore", appDir: "/srv/seqdesk", hostHome: "/home/seqdesk", tmpRoot: "/tmp" },
  host: { system: { "/usr": { exists: true }, "/etc/ld.so.cache": { exists: true }, "/etc/localtime": { symlink: "/usr/share/zoneinfo/Europe/Berlin" }, "/etc/passwd": { exists: true }, "/bin": { symlink: "usr/bin" }, "/lib": { symlink: "usr/lib" }, "/lib64": { symlink: "usr/lib64" } }, sss: true },
};

describe("mount plans", () => {
  it("allows only the run folder to be written and hides everything else", () => {
    const plan = buildMountPlan(base);
    const summary = describeMountPlan(plan);
    expect(summary.writable).toEqual(["/data/explore/runs/EXP-1--id-run1"]);
    expect(summary.readable).toEqual(expect.arrayContaining(["/usr", "/etc/ld.so.cache", "/etc/passwd", "/data/explore/environments/seqdesk-explore-python", "/opt/conda/pkgs"]));
    expect(summary.readable).not.toContain("/var/lib/sss");
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

  it("makes the root and every tmpfs read-only after the last mount, leaving the run folder writable", () => {
    const plan = buildMountPlan(base);
    const args = renderBwrapArgs(plan);
    const remounted = args.flatMap((arg, index) => (arg === "--remount-ro" ? [args[index + 1]] : []));
    expect(remounted).toEqual(["/", ...plan.tmpfs, ...plan.overlayTmpfs]);
    // A tmpfs mounted after its parent tmpfs is hidden by it, and remounting it then fails.
    expect(plan.tmpfs.indexOf("/var")).toBeLessThan(plan.tmpfs.indexOf("/var/tmp"));
    for (const [index, dst] of plan.tmpfs.entries()) expect(plan.tmpfs.slice(index + 1).some((later) => dst.startsWith(`${later}/`))).toBe(false);
    expect(remounted).not.toContain("/dev");
    expect(remounted).not.toContain(base.runFolder);
    // Every mount point has to exist before its parent turns read-only.
    const lastMount = Math.max(...["--bind", "--ro-bind", "--tmpfs", "--symlink"].map((flag) => args.lastIndexOf(flag)));
    expect(args.indexOf("--remount-ro")).toBeGreaterThan(lastMount);
    expect(args.slice(-2)).toEqual(["--chdir", base.runFolder]);
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

  it("binds only the needed parts of the system on Linux, never / or all of /etc", () => {
    const args = renderBwrapArgs(buildMountPlan(base));
    const roBinds = args.flatMap((arg, index) => (arg === "--ro-bind" ? [args[index + 1]] : []));
    expect(roBinds).not.toContain("/");
    expect(roBinds).not.toContain("/etc");
    expect(roBinds).toEqual(expect.arrayContaining(["/usr", "/etc/ld.so.cache"]));
    expect(args.join(" ")).toContain("--symlink /usr/share/zoneinfo/Europe/Berlin /etc/localtime");
    expect(roBinds.some((src) => src.startsWith("/home"))).toBe(false);
  });

  it("binds synthetic account files over /etc/passwd and /etc/group, never the host's", () => {
    const args = renderBwrapArgs(buildMountPlan(base));
    const run = "/data/explore/runs/EXP-1--id-run1";
    const passwdAt = args.indexOf("/etc/passwd");
    expect(args.slice(passwdAt - 2, passwdAt + 1)).toEqual(["--ro-bind", `${run}/control/passwd`, "/etc/passwd"]);
    const groupAt = args.indexOf("/etc/group");
    expect(args.slice(groupAt - 2, groupAt + 1)).toEqual(["--ro-bind", `${run}/control/group`, "/etc/group"]);
    expect(args.filter((arg) => arg === "/etc/passwd")).toHaveLength(1);
    expect(args).not.toContain("/var/lib/sss");
    const files = syntheticIdentityFiles({ uid: 1000, gid: 1000, home: `${run}/home` });
    expect(files.passwd).toBe(`seqdesk:x:1000:1000:SeqDesk analysis:${run}/home:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n`);
    expect(files.group).toBe("seqdesk:x:1000:\nnogroup:x:65534:\n");
    expect(syntheticIdentityFiles({ uid: 1000, gid: 1000, home: "/x:y\nz" }).passwd.split("\n")[0]).toBe("seqdesk:x:1000:1000:SeqDesk analysis:/xyz:/bin/bash");
  });

  describe("Seatbelt profile", () => {
    const run = "/Users/lab/seqdesk/explore/runs/EXP-1--id-run1";
    const darwin: MountPlanInput = {
      platform: "darwin",
      runFolder: run,
      environmentPrefix: "/Users/lab/seqdesk/explore/environments/seqdesk-explore-r",
      condaPackageDirs: ["/opt/homebrew/Caskroom/miniconda/base/pkgs"],
      roots: { runsRoot: "/Users/lab/seqdesk/explore/runs", datasetsRoot: "/Users/lab/seqdesk/explore/datasets", exploreBase: "/Users/lab/seqdesk/explore", appDir: "/Users/lab/code/seqdesk", hostHome: "/Users/lab", tmpRoot: "/var/folders/x/T" },
      host: {},
      realPaths: { "/var/folders/x/T": "/private/var/folders/x/T" },
    };
    const profile = renderSeatbeltProfile(buildMountPlan(darwin));
    const lines = profile.trim().split("\n");
    const allowReads = lines.filter((line) => line.startsWith("(allow file-read* ")).join(" ");
    const subpaths = [...allowReads.matchAll(/\(subpath "([^"]+)"\)/g)].map((match) => match[1]);
    const literals = [...allowReads.matchAll(/\(literal "([^"]+)"\)/g)].map((match) => match[1]);

    it("denies every read by default and allows back an explicit list", () => {
      const denyAll = lines.indexOf("(deny file-read*)");
      expect(denyAll).toBeGreaterThan(-1);
      expect(lines.findIndex((line) => line.startsWith("(allow file-read"))).toBeGreaterThan(denyAll);
      expect(profile).not.toMatch(/\(subpath "\/"\)/);
      expect(subpaths.sort()).toEqual([
        ...DARWIN_SYSTEM_READ.subpaths,
        ...DARWIN_DESCRIPTOR_PATHS,
        "/opt/homebrew/Caskroom/miniconda/base/pkgs",
        "/Users/lab/seqdesk/explore/environments/seqdesk-explore-r",
        run,
        `${run}/control`,
        `${run}/logs`,
      ].sort());
      expect(literals.sort()).toEqual([...DARWIN_SYSTEM_READ.literals, `${run}/control/analysis.sh`].sort());
    });

    it("never allows reading the home directory or the explore storage beyond this run", () => {
      for (const entry of [...subpaths, ...literals]) {
        const inHome = entry === "/Users/lab" || entry.startsWith("/Users/lab/");
        if (!inHome) continue;
        expect(entry === run || entry.startsWith(`${run}/`) || entry === darwin.environmentPrefix).toBe(true);
      }
      expect(profile).not.toContain('"/Users/lab/seqdesk/explore/datasets');
      expect(profile).not.toContain('"/Users/lab/seqdesk/explore/runs/EXP-2');
      expect(profile).not.toContain("/private/tmp");
      expect(profile).not.toContain("/private/var/folders");
    });

    it("lets the directories above the run be stat'ed but not listed", () => {
      const traverse = lines.find((line) => line.startsWith("(allow file-read-metadata "));
      expect(traverse).toBeDefined();
      expect(traverse).not.toMatch(/subpath/);
      expect(traverse).toContain('(literal "/Users/lab")');
      expect(traverse).toContain('(literal "/Users/lab/seqdesk/explore/runs")');
      expect(traverse).not.toContain(`(literal "${run}")`);
      expect(traverseDirs(["/a/b/c", "/a/b/c/d", "/a/x"])).toEqual(["/", "/a", "/a/b"]);
    });

    it("keeps writes to the run folder, the wrapper's files read-only and the network off", () => {
      expect(profile).toContain("(deny network*)");
      expect(profile).toContain("(deny appleevent-send)");
      // A shell's own descriptors (process substitution, /dev/stderr) and the run folder; nothing else.
      expect(profile).toContain(`(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (subpath "/dev/fd") (subpath "${run}"))`);
      expect(profile).toContain(`(deny file-write* (subpath "${run}/control") (subpath "${run}/logs"))`);
      expect(profile).toContain(`(deny file-read* (subpath "${run}/control"))`);
      expect(lines.at(-1)).toBe(`(allow file-read* (literal "${run}/control/analysis.sh"))`);
    });

    it("refuses system read paths that overlap the home directory or the storage", () => {
      const plan = buildMountPlan(darwin);
      expect(() => validateMountPlan({ ...plan, darwinSystemRead: { subpaths: ["/Users/lab/.ssh"], literals: [] } }, { runFolder: run, hostHome: "/Users/lab" })).toThrow(/home directory/);
      expect(() => validateMountPlan({ ...plan, darwinSystemRead: { subpaths: ["/Users"], literals: [] } }, { runFolder: run, hostHome: "/Users/lab" })).toThrow(/home directory/);
    });
  });

  it("hashes deterministically", () => {
    expect(mountPlanHash(buildMountPlan(base))).toBe(mountPlanHash(buildMountPlan({ ...base })));
    expect(mountPlanHash(buildMountPlan(base))).not.toBe(mountPlanHash(buildMountPlan({ ...base, network: "host" })));
  });
});
