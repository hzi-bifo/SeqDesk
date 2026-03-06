# seqdesk

NPM launcher for the SeqDesk installer.

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
```

## Notes

- The launcher downloads `https://seqdesk.com/install.sh` over HTTPS and executes it with `bash`.
- By default it sets `SEQDESK_VERSION` to this package version (unless already set).

## Publishing

The package version is auto-synced from the root `package.json` during publish
(`prepublishOnly`), so you only bump the app version once.

```bash
cd npm/seqdesk
npm publish --access public
```
