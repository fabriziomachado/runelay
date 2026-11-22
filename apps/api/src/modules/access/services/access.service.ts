import {
  fail,
  ok,
  type ResourceAccessView,
  type ResourceType,
  type Result,
  type UpdateResourceAccessInput,
} from "@runelay/shared";
import { ACCESS_MESSAGES } from "@/modules/access/constants/access.constants";
import {
  findKeyName,
  findVisibility,
  keyNameHasGrants,
  listGrantedKeyNames,
  listHiddenFor,
  listHiddenMemories,
  listOrganizationKeyNames,
  saveAccess,
} from "@/modules/access/repositories/access.repository";
import type { AccessCaller, HiddenResources, MemoryScope } from "@/modules/access/types/access.types";

export { pruneOrphanGrants } from "@/modules/access/repositories/access.repository";

const NOTHING_HIDDEN: HiddenResources = { source: new Set(), skill: new Set() };

const NOT_FOUND = {
  source: (id: string) => fail("SOURCE_NOT_FOUND", `Conexão "${id}" não encontrada.`),
  skill: (id: string) => fail("SKILL_NOT_FOUND", `Habilidade "${id}" não encontrada.`),
} as const;

export const hiddenResourcesFor = ({ organizationId, apiKeyId }: AccessCaller): Result<HiddenResources> => {
  if (!apiKeyId) return ok(NOTHING_HIDDEN);
  const keyName = findKeyName(organizationId, apiKeyId);
  if (keyName.error) return keyName;
  return listHiddenFor(organizationId, keyName.data);
};

export const OPEN_MEMORY_SCOPE: MemoryScope = { hidden: new Set(), owner: null, isKey: false };

/** Panel sessions see every memory; a key sees org memories plus its own private ones. */
export const memoryScopeFor = ({ organizationId, apiKeyId }: AccessCaller): Result<MemoryScope> => {
  if (!apiKeyId) return ok(OPEN_MEMORY_SCOPE);
  const keyName = findKeyName(organizationId, apiKeyId);
  if (keyName.error) return keyName;
  const hidden = listHiddenMemories(organizationId, keyName.data);
  return hidden.error ? hidden : ok({ hidden: hidden.data, owner: keyName.data, isKey: true });
};

export const ensureAccessAll = (caller: AccessCaller, type: ResourceType, ids: readonly string[]): Result<null> => {
  const hidden = hiddenResourcesFor(caller);
  if (hidden.error) return hidden;
  const blocked = ids.find((id) => hidden.data[type].has(id));
  return blocked === undefined ? ok(null) : fail("ACCESS_DENIED", ACCESS_MESSAGES.denied(type, blocked));
};

export const ensureAccess = (caller: AccessCaller, type: ResourceType, id: string): Result<null> =>
  ensureAccessAll(caller, type, [id]);

/** Runs `run` only when the caller may touch every id; panel sessions always pass. */
export const withAccess = async <T>(
  caller: AccessCaller,
  type: ResourceType,
  ids: readonly string[],
  run: () => Result<T> | Promise<Result<T>>,
): Promise<Result<T>> => {
  const access = ensureAccessAll(caller, type, ids);
  return access.error ? access : run();
};

export const findResourceAccess = (
  organizationId: string,
  type: ResourceType,
  id: string,
): Result<ResourceAccessView> => {
  const visibility = findVisibility(organizationId, type, id);
  if (visibility.error) return visibility;
  if (!visibility.data) return NOT_FOUND[type](id);
  const keyNames = listGrantedKeyNames(organizationId, type, id);
  if (keyNames.error) return keyNames;
  return ok({ type, id, visibility: visibility.data, keyNames: keyNames.data });
};

export const updateResourceAccess = (
  organizationId: string,
  type: ResourceType,
  id: string,
  { visibility, keyNames }: UpdateResourceAccessInput,
): Result<ResourceAccessView> => {
  const current = findVisibility(organizationId, type, id);
  if (current.error) return current;
  if (!current.data) return NOT_FOUND[type](id);
  const known = listOrganizationKeyNames(organizationId);
  if (known.error) return known;
  const unknown = keyNames.filter((name) => !known.data.includes(name));
  if (visibility === "restricted" && unknown.length) return fail("INVALID_INPUT", ACCESS_MESSAGES.unknownKeys(unknown));
  const saved = saveAccess(organizationId, type, id, visibility, visibility === "org" ? [] : keyNames);
  return saved.error ? saved : findResourceAccess(organizationId, type, id);
};

export const ensureCanIssueAgentKey = (caller: AccessCaller, name: string): Result<null> => {
  const guarded = keyNameHasGrants(caller.organizationId, name);
  if (guarded.error) return guarded;
  if (!guarded.data || !caller.apiKeyId) return ok(null);
  const callerName = findKeyName(caller.organizationId, caller.apiKeyId);
  if (callerName.error) return callerName;
  return callerName.data === name ? ok(null) : fail("ACCESS_DENIED", ACCESS_MESSAGES.protectedName(name));
};
