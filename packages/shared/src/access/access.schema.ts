import { z } from "zod";

export const RESOURCE_KEY_NAMES_LIMIT = 200;

export const resourceTypeSchema = z.enum(["source", "skill"]);

export const resourceVisibilitySchema = z.enum(["org", "restricted"]);

export const updateResourceAccessSchema = z.object({
  visibility: resourceVisibilitySchema,
  keyNames: z
    .array(z.string().trim().min(1).max(64))
    .max(RESOURCE_KEY_NAMES_LIMIT)
    .default([])
    .transform((names) => [...new Set(names)].sort()),
});
