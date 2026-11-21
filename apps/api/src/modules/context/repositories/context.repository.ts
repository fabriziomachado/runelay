import type { SQLQueryBindings } from "bun:sqlite";
import { attemptSync, type ContextHitView, type ContextSearchInput, ok, type Result } from "@runelay/shared";
import { db } from "@/db/connection";
import { SNIPPET_TOKENS } from "@/modules/context/constants/context.constants";
import type {
  BriefSources,
  MemoryIndexRow,
  PinnedMemoryRow,
  SkillIndexRow,
} from "@/modules/context/types/context.types";
import { toFtsQuery } from "@/shared/utils/fts-query";

const MEMORY_HITS = `SELECT 'memory' AS kind, slug, name, description,
    snippet(memories_fts, -1, '**', '**', '...', ${SNIPPET_TOKENS}) AS snippet, bm25(memories_fts, 4, 6, 3, 1) AS rank
  FROM memories_fts WHERE memories_fts MATCH ? AND organization_id = ?`;

const SKILL_HITS = `SELECT 'skill' AS kind, skills_fts.slug, skills_fts.name, skills_fts.description,
    snippet(skills_fts, -1, '**', '**', '...', ${SNIPPET_TOKENS}) AS snippet, bm25(skills_fts, 4, 6, 3, 1) AS rank
  FROM skills_fts JOIN skills s ON s.organization_id = skills_fts.organization_id AND s.slug = skills_fts.slug
  WHERE skills_fts MATCH ? AND skills_fts.organization_id = ? AND s.enabled = 1
    AND s.slug NOT IN (SELECT value FROM json_each(?))`;

export const searchContext = (
  organizationId: string,
  { query, kind, limit }: ContextSearchInput,
  hiddenSkills: Iterable<string> = [],
): Result<ContextHitView[]> => {
  const match = toFtsQuery(query, "OR");
  if (!match) return ok([]);
  const hidden = JSON.stringify([...hiddenSkills]);
  const params: SQLQueryBindings[] = [
    ...(kind !== "skill" ? [match, organizationId] : []),
    ...(kind !== "memory" ? [match, organizationId, hidden] : []),
  ];
  const parts = [...(kind !== "skill" ? [MEMORY_HITS] : []), ...(kind !== "memory" ? [SKILL_HITS] : [])];
  return attemptSync(
    () =>
      db
        .query<ContextHitView, SQLQueryBindings[]>(
          `SELECT kind, slug, name, description, snippet FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY rank) AS position
             FROM (${parts.join(" UNION ALL ")})
           ) ORDER BY position, kind LIMIT ?`,
        )
        .all(...params, limit),
    "STORAGE_FAILED",
  );
};

const PINNED_SQL =
  "SELECT slug, name, description FROM memories WHERE organization_id = ? AND pinned = 1 ORDER BY name";

export const listPinnedMemories = (organizationId: string): Result<PinnedMemoryRow[]> =>
  attemptSync(() => db.query<PinnedMemoryRow, [string]>(PINNED_SQL).all(organizationId), "STORAGE_FAILED");

export const loadBriefSources = (organizationId: string, hiddenSkills: Iterable<string> = []): Result<BriefSources> =>
  attemptSync(
    () => ({
      pinned: db.query<PinnedMemoryRow, [string]>(PINNED_SQL).all(organizationId),
      memories: db
        .query<MemoryIndexRow, [string]>(
          `SELECT slug, name, description, type FROM memories WHERE organization_id = ? AND pinned = 0
           ORDER BY CASE type WHEN 'feedback' THEN 0 WHEN 'user' THEN 1 WHEN 'project' THEN 2 ELSE 3 END, updated_at DESC`,
        )
        .all(organizationId),
      skills: db
        .query<SkillIndexRow, [string, string]>(
          `SELECT slug, name, description FROM skills WHERE organization_id = ? AND enabled = 1
           AND slug NOT IN (SELECT value FROM json_each(?)) ORDER BY name`,
        )
        .all(organizationId, JSON.stringify([...hiddenSkills])),
    }),
    "STORAGE_FAILED",
  );
