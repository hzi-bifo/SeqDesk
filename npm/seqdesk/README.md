# seqdesk

CLI launcher for installing, configuring, and diagnosing SeqDesk.

Requires Node.js 22.13.0+ on the 22.x line or Node.js 24.x; Node.js 24 is recommended.

## Usage

```bash
npm i -g seqdesk@latest
seqdesk --interactive
```

Pass any installer flags directly:

```bash
seqdesk -y --dir /opt/seqdesk
seqdesk -y --use-pm2 --config ./infrastructure-setup.json
seqdesk -y --reconfigure --config ./infrastructure-setup.json
seqdesk -y --dir /opt/seqdesk --run-doctor
```

Check an installed directory:

```bash
seqdesk doctor --dir /opt/seqdesk
seqdesk doctor --dir /opt/seqdesk --url http://127.0.0.1:3000
seqdesk doctor --dir /opt/seqdesk --json
```

Apply hosted profile assets to an existing install:

```bash
seqdesk assets apply --dir /opt/seqdesk \
  --profile dev \
  --profile-code "$DEV_SETUP_CODE"
```

This reuses the installed app and applies profile-declared pipeline database
assets and seed fixtures without reinstalling SeqDesk.

Run installed pipelines from the server shell:

```bash
seqdesk pipeline list --dir /opt/seqdesk --catalog all --enabled
seqdesk pipeline run metaxpath --dir /opt/seqdesk --study <study-id> --watch
seqdesk pipeline run fastq-checksum --dir /opt/seqdesk --order <order-id> --samples id1,id2 --json
seqdesk pipeline status <run-id> --dir /opt/seqdesk --watch
seqdesk pipeline logs <run-id> --dir /opt/seqdesk --type error --tail 200
seqdesk pipeline outputs <run-id> --dir /opt/seqdesk --json
seqdesk pipeline debug <run-id> --dir /opt/seqdesk --format text --out debug.txt
seqdesk pipeline cancel <run-id> --dir /opt/seqdesk
```

Pipeline commands run locally against the installed app database and use the
same SeqDesk run records and launcher services as the web UI. They do not
require browser login; shell access to `--dir` is treated as operator access.
By default the first `FACILITY_ADMIN` user is used for attribution, or pass
`--user-email admin@example.org` when starting a run.

For a full manual test flow, see [MANUAL_INSTALL.md](./MANUAL_INSTALL.md).

## Notes

- The npm launcher is the supported public install entry point.
- The launcher downloads `https://seqdesk.org/install.sh` over HTTPS and
  executes it with `bash` internally. Users normally do not need to call the
  shell installer directly.
- Publishing this npm package does not update the public curl installer. Changes
  to the shell installer become visible at `https://seqdesk.org/install.sh`
  only after the SeqDesk.com `public/install.sh` file is updated and deployed.
- By default it sets `SEQDESK_VERSION` to this package version (unless already set).
- The installer writes a timestamped log to `/tmp/seqdesk-install-*.log` unless
  `SEQDESK_LOG` is set.
- Interactive installs show a compact spinner for long-running work; command
  output stays in the install log.
- `seqdesk doctor` runs locally and does not download the installer. It checks
  install files, PostgreSQL reachability, runtime config, auth providers, and
  setup status when the app URL is known.
- `seqdesk assets apply` runs locally against an existing install. It resolves
  hosted install profiles into a temporary file, calls the installed
  `scripts/apply-install-profile-assets.mjs` script, and removes the temporary
  profile file after the command exits.
- `seqdesk pipeline ...` dispatches to the installed
  `scripts/pipeline-cli.js` script so CLI-started runs follow the same local
  server configuration, pipeline packages, execution policy, and compatibility
  guards as UI-started runs.
- Successful installs print a matching `seqdesk doctor` command. Pass
  `--run-doctor` to run it automatically when the CLI is available.

## Publishing

The package version is auto-synced from the root `package.json` during publish
(`prepublishOnly`), so you only bump the app version once.

```bash
cd npm/seqdesk
npm publish --access public
```
