import {
  type CreateMemoryInput,
  fail,
  type ImportMemoriesInput,
  type ListMemoriesInput,
  type MemoryView,
  type MemoryVisibility,
  type MemoryWriteInput,
  memoryImportItemSchema,
  ok,
  type Result,
  type UpdateMemoryInput,
} from "@runelay/shared";
import { ACCESS_MESSAGES } from "@/modules/access/constants/access.constants";
import { OPEN_MEMORY_SCOPE } from "@/modules/access/services/access.service";
import type { MemoryScope } from "@/modules/access/types/access.types";
import { searchContext } from "@/modules/context/services/context.service";
import { SIMILAR_HINT, SIMILAR_LIMIT, SIMILAR_TOKEN } from "@/modules/memories/constants/memory.constants";
import {
  deleteMemoryRow,
  describeGraph,
  describeHealth,
  findMemoryOwnership,
  findMemory as findMemoryRow,
  insertMemory,
  listMemories as listMemoryRows,
  listVersions,
  memoryDenied,
  memoryExists,
  updateMemoryRow,
  upsertMemories,
} from "@/modules/memories/repositories/memory.repository";
import type {
  MemoryImportItemView,
  MemoryImportView,
  MemoryWriteView,
  RawMemoryImportItem,
  SimilarMemoryView,
} from "@/modules/memories/types/memory.types";

const ownerless = (slug: string) => fail("INVALID_INPUT", ACCESS_MESSAGES.memoryOwnerless(slug));

/** Runs `run` only when `slug` is not another key's private memory. */
const visibleOnly = <T>(scope: MemoryScope, slug: string, run: () => Result<T>): Result<T> =>
  scope.hidden.has(slug) ? memoryDenied(slug) : run();

/** Only the owner key (or the panel) changes visibility, and a memory without an owner cannot become private. */
const checkVisibilityChange = (
  organizationId: string,
  slug: string,
  visibility: MemoryVisibility | undefined,
  scope: MemoryScope,
): Result<null> => {
  if (!visibility) return ok(null);
  const current = findMemoryOwnership(organizationId, slug);
  if (current.error) return current;
  if (!current.data || current.data.visibility === visibility) return ok(null);
  if (scope.isKey && (!scope.owner || current.data.ownerKey !== scope.owner)) {
    return fail("ACCESS_DENIED", ACCESS_MESSAGES.memoryVisibility(slug));
  }
  return visibility === "private" && !current.data.ownerKey ? ownerless(slug) : ok(null);
};

export const findMemory = (organizationId: string, slug: string, scope: MemoryScope = OPEN_MEMORY_SCOPE) =>
  findMemoryRow(organizationId, slug, scope.hidden);

export const listMemories = (organizationId: string, input: ListMemoriesInput, scope = OPEN_MEMORY_SCOPE) =>
  listMemoryRows(organizationId, input, scope.hidden);

export const describeMemoryHealth = (organizationId: string, staleDays: number, scope = OPEN_MEMORY_SCOPE) =>
  describeHealth(organizationId, staleDays, scope.hidden);

export const describeMemoryGraph = (organizationId: string, scope = OPEN_MEMORY_SCOPE) =>
  describeGraph(organizationId, scope.hidden);

export const listMemoryVersions = (organizationId: string, slug: string, scope = OPEN_MEMORY_SCOPE) =>
  visibleOnly(scope, slug, () => listVersions(organizationId, slug));

export const deleteMemory = (organizationId: string, slug: string, scope = OPEN_MEMORY_SCOPE) =>
  visibleOnly(scope, slug, () => deleteMemoryRow(organizationId, slug));

/** A named key's new memory is private to it unless it asks for "org". */
export const createMemory = (
  organizationId: string,
  input: CreateMemoryInput,
  createdAt: string | null = null,
  scope: MemoryScope = OPEN_MEMORY_SCOPE,
): Result<MemoryView> =>
  visibleOnly(scope, input.slug, () => {
    const visibility = input.visibility ?? (scope.owner ? "private" : "org");
    if (visibility === "private" && !scope.owner) return ownerless(input.slug);
    const created = insertMemory(organizationId, { ...input, visibility }, createdAt, scope.owner);
    return created.error ? created : findMemoryRow(organizationId, input.slug, scope.hidden);
  });

export const updateMemory = (
  organizationId: string,
  slug: string,
  input: UpdateMemoryInput,
  scope: MemoryScope = OPEN_MEMORY_SCOPE,
): Result<MemoryView> =>
  visibleOnly(scope, slug, () => {
    const allowed = checkVisibilityChange(organizationId, slug, input.visibility, scope);
    if (allowed.error) return allowed;
    const updated = updateMemoryRow(organizationId, slug, input);
    return updated.error ? updated : findMemoryRow(organizationId, slug, scope.hidden);
  });

export const findSimilarMemories = (
  organizationId: string,
  { slug, name, description }: MemoryWriteInput,
  hidden: ReadonlySet<string> = OPEN_MEMORY_SCOPE.hidden,
): SimilarMemoryView[] => {
  const query = `${name ?? slug.replaceAll("-", " ")} ${description ?? ""}`.match(SIMILAR_TOKEN)?.join(" ");
  if (!query) return [];
  const hits = searchContext(organizationId, { query, kind: "memory", limit: SIMILAR_LIMIT + 1 }, [], hidden);
  return (hits.data ?? [])
    .filter((hit) => hit.slug !== slug)
    .slice(0, SIMILAR_LIMIT)
    .map((hit) => ({ slug: hit.slug, name: hit.name }));
};

export const writeMemory = (
  organizationId: string,
  input: MemoryWriteInput,
  createdAt?: string,
  scope: MemoryScope = OPEN_MEMORY_SCOPE,
): Result<MemoryWriteView> => {
  const { slug, ...fields } = input;
  if (scope.hidden.has(slug)) return memoryDenied(slug);
  const exists = memoryExists(organizationId, slug);
  if (exists.error) return exists;
  if (exists.data) return updateMemory(organizationId, slug, fields, scope);
  const similar = findSimilarMemories(organizationId, input, scope.hidden);
  const created = createMemory(
    organizationId,
    {
      slug,
      name: fields.name ?? slug,
      description: fields.description ?? "",
      type: fields.type ?? "project",
      body: fields.body,
      pinned: false,
      visibility: fields.visibility,
    },
    createdAt ? new Date(createdAt).toISOString() : null,
    scope,
  );
  if (created.error || similar.length === 0) return created;
  return ok({ ...created.data, similar, hint: SIMILAR_HINT });
};

const importMemoryItem = (
  organizationId: string,
  item: RawMemoryImportItem,
  scope: MemoryScope,
): MemoryImportItemView => {
  const parsed = memoryImportItemSchema.safeParse(item);
  if (!parsed.success) {
    return { slug: item.slug, status: "failed", error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  const { createdAt, ...input } = parsed.data;
  const existing = findMemoryRow(organizationId, input.slug, scope.hidden);
  if (existing.data?.body === input.body) return { slug: input.slug, status: "skipped" };
  if (existing.error && existing.error.code !== "MEMORY_NOT_FOUND") {
    return { slug: input.slug, status: "failed", error: existing.error.message };
  }
  const written = writeMemory(organizationId, input, createdAt, scope);
  if (written.error) return { slug: input.slug, status: "failed", error: written.error.message };
  const { similar } = written.data;
  return { slug: input.slug, status: existing.data ? "updated" : "created", ...(similar ? { similar } : {}) };
};

export const importMemoryItems = (
  organizationId: string,
  items: RawMemoryImportItem[],
  scope: MemoryScope = OPEN_MEMORY_SCOPE,
): MemoryImportView => {
  const results = items.map((item) => importMemoryItem(organizationId, item, scope));
  const count = (status: MemoryImportItemView["status"]) => results.filter((item) => item.status === status).length;
  return {
    created: count("created"),
    updated: count("updated"),
    skipped: count("skipped"),
    failed: count("failed"),
    items: results,
    ...(results.some((item) => item.similar) ? { hint: SIMILAR_HINT } : {}),
  };
};

export const importMemories = (
  organizationId: string,
  { memories }: ImportMemoriesInput,
  scope: MemoryScope = OPEN_MEMORY_SCOPE,
) => upsertMemories(organizationId, memories, scope);
