import { z } from "zod";
import { paginationSchema } from "../pagination/pagination.schema";

export const memoryTypeSchema = z.enum(["user", "feedback", "project", "reference"]);

export const memorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen");

export const memoryVisibilitySchema = z.enum(["org", "private"]);

const memoryFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(400),
  type: memoryTypeSchema,
  body: z.string().max(100_000),
  pinned: z.boolean(),
  visibility: memoryVisibilitySchema,
};

export const createMemorySchema = z.object({
  ...memoryFields,
  slug: memorySlugSchema,
  description: memoryFields.description.default(""),
  pinned: memoryFields.pinned.default(false),
  visibility: memoryVisibilitySchema.optional(),
});

export const updateMemorySchema = z
  .object(memoryFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Envie ao menos um campo");

export const listMemoriesSchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  type: memoryTypeSchema.optional(),
  pinned: z.enum(["true", "false"]).optional(),
});

export const pushedAtSchema = z.iso.datetime({ offset: true });

export const importedMemorySchema = createMemorySchema.extend({ updatedAt: pushedAtSchema.optional() });

export const importMemoriesSchema = z.object({
  memories: z.array(importedMemorySchema).max(2000),
});

export const memoryWriteSchema = z.object({
  slug: memorySlugSchema,
  body: memoryFields.body,
  name: memoryFields.name.optional(),
  description: memoryFields.description.optional(),
  type: memoryTypeSchema.optional(),
  visibility: memoryVisibilitySchema.optional(),
});

export const MEMORY_IMPORT_TOOL_LIMIT = 200;

export const memoryImportItemSchema = memoryWriteSchema.extend({ createdAt: pushedAtSchema.optional() });
