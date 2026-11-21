import type { ResourceType } from "@runelay/shared";

export type HiddenResources = Record<ResourceType, ReadonlySet<string>>;

export interface AccessCaller {
  organizationId: string;
  apiKeyId: string | null;
}
