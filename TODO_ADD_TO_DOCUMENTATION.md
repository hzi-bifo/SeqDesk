# TODO: Add Installer Diagnostics To SeqDesk.com Documentation

When updating the SeqDesk.com documentation, add a short installer diagnostics
section covering:

- The installer now writes a default log file to `/tmp/seqdesk-install-*.log`.
- Set `SEQDESK_LOG=/path/to/install.log` to choose a custom log path.
- Interactive installs show a small Unicode spinner for long-running commands;
  non-interactive installs use static progress lines and keep command output in
  the log.
- Successful installs print a `seqdesk doctor --dir ... --url ...` command.
- Pass `--run-doctor` to run `seqdesk doctor` automatically after install when
  the `seqdesk` CLI is available.
- If the CLI is missing, install it with `npm install -g seqdesk`, then run the
  printed doctor command.
- The `seqdesk doctor` text output now uses the same minimal key/value style as
  the installer; update any public docs output examples that still show
  `[PASS]` / `[WARN]` rows.

Suggested docs location: the SeqDesk.com installation or troubleshooting page.
