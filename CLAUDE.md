# CLAUDE.md

Instructions for Claude Code when working with this codebase.

## UI Guidelines

- **Do not use emojis** in the UI or code
- **Do not use the Sparkles icon** - use simple indicators like dots or standard icons instead
- Keep the UI clean and professional
- See `docs/design.md` for detailed design patterns (dialogs, colors, badges)

### Page Layout

Use the `PageContainer` component for consistent spacing across all pages:

```tsx
import { PageContainer } from "@/components/layout/PageContainer";

// Full width (default) - for list pages
<PageContainer>...</PageContainer>

// Narrow width - for forms/settings
<PageContainer maxWidth="narrow">...</PageContainer>

// Medium width - for detail pages
<PageContainer maxWidth="medium">...</PageContainer>
```

Width variants:
- `full` (default): No max-width - for list pages
- `narrow`: max-w-2xl (672px) - for forms, settings
- `medium`: max-w-4xl (896px) - for detail pages
- `wide`: max-w-6xl (1152px) - for complex layouts

### Field Templates (MIxS and Custom)

Field templates for the Form Builder are loaded from JSON files in `data/field-templates/`.
This allows updating field definitions without code changes.

**Adding new templates:**
1. Create a JSON file in `data/field-templates/` (e.g., `mixs-air.json`)
2. Follow the schema:
```json
{
  "name": "Template Name",
  "description": "Description shown in form builder",
  "version": "1.0.0",
  "source": "https://optional-link-to-spec",
  "category": "mixs",  // or omit for general
  "fields": [
    {
      "type": "text",
      "label": "Field Label",
      "name": "field_name",
      "required": false,
      "visible": true,
      "helpText": "Help text for users",
      "placeholder": "Example value",
      "aiValidation": {
        "enabled": true,
        "prompt": "AI prompt describing valid input",
        "strictness": "moderate"
      }
    }
  ]
}
```
3. Restart the dev server - templates are loaded on page load

## Development

### Running the dev server

```bash
npm run dev
```

Or on a different port:
```bash
PORT=3001 npm run dev
```

### Database

Uses Prisma with SQLite. To update the database after schema changes:

```bash
npx prisma db push
```

**After resetting the database**, always run the seed script to create initial data (users, departments, form config):

```bash
npx prisma db seed
```

Default login credentials after seeding:
- Admin: `admin@example.com` / `admin`
- Researcher: `user@example.com` / `user`

### Tech Stack

- Next.js 14+ with App Router
- TypeScript
- Prisma ORM
- NextAuth.js for authentication
- Tailwind CSS + shadcn/ui components
- React Flow for pipeline DAG visualization

### Adding nf-core Pipelines

Pipeline workflow definitions are stored as JSON files in `data/pipeline-definitions/`.
See **[docs/adding-pipelines.md](docs/adding-pipelines.md)** for the full guide.

**Quick start:**
```bash
# 1. Generate initial definition from nf-core
npx ts-node scripts/generate-pipeline-def.ts <pipeline-name>

# 2. Edit the generated JSON to fix workflow dependencies
vim data/pipeline-definitions/<pipeline-name>.json

# 3. Done! The app automatically loads it
```

**Available pipelines:**
- `mag` - Metagenome assembly and binning
- (add more by creating JSON files)
