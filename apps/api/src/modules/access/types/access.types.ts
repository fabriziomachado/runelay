import type { ResourceType } from "@runelay/shared";

export type HiddenResources = Record<ResourceType, ReadonlySet<string>>;

export interface AccessCaller {
  organizationId: string;
  apiKeyId: string | null;
}

/** What a caller may see of the memories: `hidden` are other keys' private slugs, `owner` names new private ones. */
export interface MemoryScope {
  hidden: ReadonlySet<string>;
  owner: string | null;
  isKey: boolean;
}
