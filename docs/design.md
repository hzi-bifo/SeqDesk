# DESIGN.md

Design guidelines and patterns for consistent UI across the application.

## Page Layout

All dashboard and admin pages use the `PageContainer` component for consistent spacing.

### PageContainer Component

Located at: `src/components/layout/PageContainer.tsx`

```tsx
import { PageContainer } from "@/components/layout/PageContainer";

// Full width (default) - for list pages
<PageContainer>...</PageContainer>

// Narrow width (max-w-2xl) - for forms and settings
<PageContainer maxWidth="narrow">...</PageContainer>

// Medium width (max-w-4xl) - for detail pages
<PageContainer maxWidth="medium">...</PageContainer>

// Wide width (max-w-6xl) - for content-heavy pages
<PageContainer maxWidth="wide">...</PageContainer>
```

### Width Variants

| Variant | Max Width | Use Case |
|---------|-----------|----------|
| `full` (default) | None | List pages (orders, studies, admin tables) |
| `narrow` | 672px (max-w-2xl) | Forms, settings, single-column content |
| `medium` | 896px (max-w-4xl) | Detail pages, review forms |
| `wide` | 1152px (max-w-6xl) | Complex multi-column content |

### Standard Padding

All pages use consistent padding: `p-8` (32px on all sides)

### Usage Guidelines

1. **List pages** (Orders, Studies, Users): Use `<PageContainer>` (full width)
2. **Form pages** (Settings, Create forms): Use `<PageContainer maxWidth="narrow">`
3. **Detail pages** (Order detail, Review step): Use `<PageContainer maxWidth="medium">`
4. **Loading states**: Wrap loader in `<PageContainer className="flex items-center justify-center min-h-[400px]">`

## Dialogs

The base `DialogContent` component has no default max-width constraint, allowing flexible sizing per use case.

### Dialog Sizes

Use these consistent size classes for dialogs:

| Size | Class | Max Width | Use Case |
|------|-------|-----------|----------|
| Small | `max-w-sm` | 384px | Simple confirmations, alerts |
| Default | `max-w-lg` | 512px | Standard forms, simple modals |
| Medium | `max-w-2xl` | 672px | Forms with more fields |
| Large | `!w-[90vw] !max-w-[1200px]` | 1200px | Complex editors, multi-column layouts |

### Examples

```tsx
// Small dialog (confirmation)
<DialogContent className="max-w-sm">

// Default dialog (standard form)
<DialogContent className="max-w-lg">

// Large dialog (form builder, complex editors)
<DialogContent className="!w-[90vw] !max-w-[1200px] max-h-[90vh] overflow-y-auto">
```

### Notes

- Use `!important` prefix (`!w-[90vw]`) for large dialogs to ensure width is applied
- Add `max-h-[90vh] overflow-y-auto` for dialogs with potentially long content
- Multi-column layouts work best with large dialogs: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8`

## Colors

### AI Features

AI-related UI elements use violet/purple tones:
- Background: `bg-violet-500/5`, `bg-violet-500/10`, `bg-violet-500/15`
- Border: `border-violet-500/20`
- Text: `text-violet-600`
- Buttons: `bg-violet-500 hover:bg-violet-600`

### Status Indicators

- Success/Valid: `text-green-600`, `bg-green-500/10`, `border-green-500/30`
- Error/Invalid: `text-red-600`, `bg-red-500/10`, `border-red-500/30`
- Warning: `text-amber-600`, `bg-amber-500/10`, `border-amber-500/30`
- Info: `text-blue-600`, `bg-blue-500/10`, `border-blue-500/30`

### Badges

```tsx
// System badge
<span className="text-xs px-2 py-0.5 rounded bg-slate-500/10 text-slate-600">System</span>

// AI badge
<span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 font-medium">AI</span>

// Required badge
<span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">Required</span>

// Type badge
<span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{type}</span>
```

## Icons

- Do NOT use emojis in the UI
- Do NOT use the Sparkles icon - use simple dots or text badges instead
- Prefer Lucide icons for consistency
