# seqdesk

CLI launcher for installing and updating SeqDesk.

## Usage

```bash
npm i -g seqdesk
seqdesk
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

For a full manual test flow, see [MANUAL_INSTALL.md](./MANUAL_INSTALL.md).

## Notes

- The launcher downloads `https://seqdesk.com/install.sh` over HTTPS and executes it with `bash`.
- By default it sets `SEQDESK_VERSION` to this package version (unless already set).
- The installer writes a timestamped log to `/tmp/seqdesk-install-*.log` unless
  `SEQDESK_LOG` is set.
- Interactive installs show a compact spinner for long-running work; command
  output stays in the install log.
- `seqdesk doctor` runs locally and does not download the installer. It checks
  install files, PostgreSQL reachability, runtime config, auth providers, and
  setup status when the app URL is known.
- Successful installs print a matching `seqdesk doctor` command. Pass
  `--run-doctor` to run it automatically when the CLI is available.

## Publishing

The package version is auto-synced from the root `package.json` during publish
(`prepublishOnly`), so you only bump the app version once.

```bash
cd npm/seqdesk
npm publish --access public
```
