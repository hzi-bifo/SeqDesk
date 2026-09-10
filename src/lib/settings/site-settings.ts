import { z } from "zod";

const plainName = z.string().trim().min(1, "Enter an installation name.").max(120, "Use at most 120 characters.")
  .refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Use a single-line name without control characters.");
const contactEmail = z.string().trim().max(254, "Use at most 254 characters.")
  .refine(value => value === "" || z.email().safeParse(value).success, "Enter a valid contact email or leave it empty.");

export const installationDetailsSchema = z.object({ name: plainName, contactEmail });

export const installationDetailsUpdateSchema = installationDetailsSchema.partial().extend({
  expectedRevision: z.iso.datetime().nullable(),
}).strict().refine(value => value.name !== undefined || value.contactEmail !== undefined, "Choose at least one field to update.");

const sourceSchema = z.enum(["default", "database", "file", "env"]);
export const installationDetailsResponseSchema = z.object({
  settings: z.object({ name: z.string(), contactEmail: z.string() }),
  sources: z.object({ name: sourceSchema, contactEmail: sourceSchema }),
  editable: z.object({ name: z.boolean(), contactEmail: z.boolean() }),
  revision: z.iso.datetime().nullable(),
  readOnlyReason: z.string().nullable(),
});

export type InstallationDetails = z.infer<typeof installationDetailsResponseSchema>;
export type InstallationDetailsValues = z.infer<typeof installationDetailsSchema>;
