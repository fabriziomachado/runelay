import type { z } from "zod";
import type { resourceTypeSchema, resourceVisibilitySchema, updateResourceAccessSchema } from "./access.schema";

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ResourceVisibility = z.infer<typeof resourceVisibilitySchema>;
export type UpdateResourceAccessInput = z.infer<typeof updateResourceAccessSchema>;

export interface ResourceAccessView {
  type: ResourceType;
  id: string;
  visibility: ResourceVisibility;
  keyNames: string[];
}
