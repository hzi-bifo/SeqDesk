# SeqDesk

A modern sequencing facility management system built with Next.js for managing sequencing orders, samples, and data submissions to the European Nucleotide Archive (ENA).

## Features

- **Order Management**: Create and track sequencing orders with customizable workflows
- **Sample Tracking**: Manage samples with MIxS-compliant metadata
- **Study Organization**: Group samples into studies for ENA submission
- **Sequencing File Management**: Auto-discovery and assignment of FASTQ files
- **Pipeline Integration**: Run nf-core pipelines (MAG) with real-time progress tracking
- **ENA Submission**: Submit data to the European Nucleotide Archive
- **Role-based Access**: Separate workflows for researchers and facility admins

## Tech Stack

- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Database**: Prisma ORM with SQLite
- **Authentication**: NextAuth.js
- **UI**: Tailwind CSS + shadcn/ui components
- **Visualization**: React Flow for pipeline DAGs

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Required variables:
```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="your-secret-key"
ANTHROPIC_API_KEY="sk-ant-..."  # Optional: for AI validation features
```

### 3. Set up the database

```bash
# Push the schema to the database
npx prisma db push

# Seed with initial data (users, departments, form config)
npx prisma db seed
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Default Login Credentials

After seeding the database:
- **Admin**: `admin@example.com` / `admin`
- **Researcher**: `user@example.com` / `user`

## Database Management

### Reset and reseed the database

```bash
# Force reset (clears all data)
npx prisma db push --force-reset

# Reseed with initial data
npx prisma db seed
```

### Update schema

After making changes to `prisma/schema.prisma`:

```bash
npx prisma db push
```

## Project Structure

```
SeqDesk/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── admin/        # Admin pages
│   │   ├── api/          # API routes
│   │   └── dashboard/    # User dashboard pages
│   ├── components/       # React components
│   └── lib/              # Utilities, Prisma client
├── prisma/               # Database schema and seed
├── data/                 # JSON data files
│   ├── field-templates/  # MIxS field templates
│   └── pipeline-definitions/  # nf-core pipeline DAGs
├── docs/                 # Documentation
└── scripts/              # Utility scripts
```

## Documentation

See the `docs/` folder for detailed documentation:
- [Adding Pipelines](docs/adding-pipelines.md) - How to add new nf-core pipeline definitions
- [Backend Features](docs/backend-features.md) - Pipeline system architecture
- [ENA Integration](docs/ena-integration-plan.md) - ENA submission workflow
- [Sequencing Files](docs/sequencing-files-plan.md) - File discovery and assignment

## Development

See [CLAUDE.md](CLAUDE.md) for development guidelines and code conventions.

## License

MIT
