import type { z } from "zod";
import type {
  createMemorySchema,
  importedMemorySchema,
  importMemoriesSchema,
  listMemoriesSchema,
  memoryImportItemSchema,
  memoryTypeSchema,
  memoryVisibilitySchema,
  memoryWriteSchema,
  updateMemorySchema,
} from "./memory.schema";

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryVisibility = z.infer<typeof memoryVisibilitySchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;
export type ImportMemoriesInput = z.infer<typeof importMemoriesSchema>;
export type ImportedMemoryInput = z.infer<typeof importedMemorySchema>;
export type MemoryWriteInput = z.infer<typeof memoryWriteSchema>;
export type MemoryImportItemInput = z.infer<typeof memoryImportItemSchema>;

export interface ImportResultView {
  imported: number;
  written: number;
  skipped: string[];
  unchanged: string[];
}

export interface MemoryListItemView {
  slug: string;
  name: string;
  description: string;
  type: MemoryType;
  pinned: boolean;
  visibility: MemoryVisibility;
  ownerKey: string | null;
  linkCount: number;
  backlinkCount: number;
  updatedAt: string;
}

export interface MemoryView extends MemoryListItemView {
  body: string;
  links: string[];
  backlinks: string[];
  brokenLinks: string[];
  createdAt: string;
}

export interface MemoryVersionView {
  id: number;
  name: string;
  description: string;
  body: string;
  createdAt: string;
}

export interface MemoryRefView {
  slug: string;
  name: string;
  updatedAt: string;
}

export interface MemoryHealthView {
  staleDays: number;
  stale: MemoryRefView[];
  brokenLinks: { from: string; to: string }[];
  isolated: MemoryRefView[];
  total: number;
}

export interface MemoryGraphNodeView {
  slug: string;
  name: string;
  type: MemoryType;
  pinned: boolean;
  degree: number;
}

export interface MemoryGraphEdgeView {
  source: string;
  target: string;
}

export interface MemoryGraphView {
  nodes: MemoryGraphNodeView[];
  edges: MemoryGraphEdgeView[];
}
