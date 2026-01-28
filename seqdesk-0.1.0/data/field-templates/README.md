# Field Templates

This folder contains JSON files that define suggested field templates for the Form Builder.

## Structure

Each JSON file represents a template group (e.g., MIxS Core, MIxS Soil, General fields).

### Schema

```json
{
  "name": "Template Name",
  "description": "Description shown in the form builder UI",
  "version": "1.0.0",
  "source": "https://link-to-specification (optional)",
  "category": "mixs",
  "fields": [
    {
      "type": "text|textarea|select|multiselect|checkbox|number|date",
      "label": "Field Label",
      "name": "field_key_name",
      "required": false,
      "visible": true,
      "placeholder": "Placeholder text",
      "helpText": "Help text shown below the field",
      "example": "Example value",
      "options": [
        { "value": "opt1", "label": "Option 1" }
      ],
      "simpleValidation": {
        "minLength": 3,
        "maxLength": 100,
        "minValue": 0,
        "maxValue": 14,
        "pattern": "^[A-Z]+$",
        "patternMessage": "Custom error message"
      },
      "aiValidation": {
        "enabled": true,
        "prompt": "Describe what valid input looks like",
        "strictness": "lenient|moderate|strict"
      }
    }
  ]
}
```

### Field Types

- `text` - Single line text input
- `textarea` - Multi-line text input
- `select` - Dropdown (requires `options`)
- `multiselect` - Multi-select dropdown (requires `options`)
- `checkbox` - Boolean checkbox
- `number` - Numeric input
- `date` - Date picker

### Categories

- `mixs` - MIxS standard fields (shown with green badge)
- (omit) - General fields

## Current Templates

- `general.json` - Common fields for sequencing orders
- `mixs-core.json` - GSC MIxS core fields (location, environment)
- `mixs-soil.json` - MIxS soil environment checklist
- `mixs-water.json` - MIxS water environment checklist
- `mixs-host-associated.json` - MIxS host-associated checklist
- `mixs-sequencing.json` - MIxS sequencing and methods fields

## Adding New Templates

1. Create a new JSON file following the schema above
2. Restart the development server
3. The template will appear in the Form Builder under "Suggested Fields"

## MIxS Reference

MIxS (Minimum Information about any (x) Sequence) is maintained by the Genomic Standards Consortium:
https://genomicsstandardsconsortium.github.io/mixs/
