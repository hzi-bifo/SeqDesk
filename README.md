# SeqDesk

[![CI](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/hzi-bifo/SeqDesk/branch/main/graph/badge.svg?token=SMQXMDYACH)](https://codecov.io/gh/hzi-bifo/SeqDesk)

SeqDesk is a sequencing facility management system for handling orders, samples, studies, sequencing files, and pipeline execution.

This repository intentionally keeps documentation minimal for public use.
Full user and operator documentation is published at:
[https://www.seqdesk.com/docs](https://www.seqdesk.com/docs)

## Quick Install

```bash
curl -fsSL https://seqdesk.com/install.sh | bash
```

NPM launcher (same installer flow):

```bash
npm i -g seqdesk
seqdesk
```

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk
npm install
```

### 2. Configure runtime values

```bash
cp seqdesk.config.example.json seqdesk.config.json
```

Set at least:

```json
{
  "runtime": {
    "databaseUrl": "file:./dev.db",
    "nextAuthUrl": "http://localhost:3000",
    "nextAuthSecret": "replace-with-a-random-secret"
  }
}
```

### 3. Initialize database

```bash
npx prisma db push
npx prisma db seed
```

### 4. Start

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default seeded users:
- Admin: `admin@example.com` / `admin`
- Researcher: `user@example.com` / `user`

## Common Commands

```bash
npm run dev
npm run build
npm run start
npm test
```

## Public Docs

- Main docs: [https://www.seqdesk.com/docs](https://www.seqdesk.com/docs)
- Releases and update info: [https://www.seqdesk.com](https://www.seqdesk.com)

## License

This project is licensed under the GNU Affero General Public License v3.0.
See the [LICENSE](./LICENSE) file for the full license text.
