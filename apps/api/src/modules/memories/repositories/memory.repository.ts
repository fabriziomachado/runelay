import type { SQLQueryBindings } from "bun:sqlite";
import {
  attemptSync,
  type CreateMemoryInput,
  fail,
  type ImportedMemoryInput,
  type ImportResultView,
  type ListMemoriesInput,
  type MemoryGraphEdgeView,
  type MemoryGraphView,
  type MemoryHealthView,
  type MemoryListItemView,
  type MemoryRefView,
  type MemoryVersionView,
  type MemoryView,
  type MemoryVisibility,
  ok,
  type Page,
  type Result,
  type UpdateMemoryInput,
} from "@runelay/shared";
import { db } from "@/db/connection";
import { ACCESS_MESSAGES } from "@/modules/access/constants/access.constants";
import {
  MEMORY_GRAPH_EDGES,
  MEMORY_LIST_COLUMNS,
  MEMORY_REF_COLUMNS,
} from "@/modules/memories/constants/memory.constants";
import type {
  MemoryContent,
  MemoryDetailRow,
  MemoryGraphNodeRow,
  MemoryListRow,
  StoredMemoryRow,
} from "@/modules/memories/types/memory.types";
import { parseLinks } from "@/modules/memories/utils/parse-links";
import { SQL_NOW } from "@/shared/constants/sql.constants";
import { toFtsQuery } from "@/shared/utils/fts-query";
import { pageOf } from "@/shared/utils/page";
import { isStoredNewer } from "@/shared/utils/stored-newer";

const NONE: ReadonlySet<string> = new Set();

const hiddenJson = (hidden: ReadonlySet<string>) => JSON.stringify([...hidden]);

export const memoryDenied = (slug: string) => fail("ACCESS_DENIED", ACCESS_MESSAGES.memoryDenied(slug));

const syncDerived = (organizationId: string, { slug, name, description, body }: MemoryContent) => {
  db.query("DELETE FROM memory_links WHERE organization_id = ? AND from_slug = ?").run(organizationId, slug);
  const insertLink = db.query(
    "INSERT OR IGNORE INTO memory_links (organization_id, from_slug, to_slug) VALUES (?, ?, ?)",
  );
  for (const target of parseLinks(body, slug)) insertLink.run(organizationId, slug, target);
  db.query("DELETE FROM memories_fts WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
  db.query("INSERT INTO memories_fts (slug, name, description, body, organization_id) VALUES (?, ?, ?, ?, ?)").run(
    slug,
    name,
    description,
    body,
    organizationId,
  );
};

const isSameMemory = (stored: StoredMemoryRow, memory: ImportedMemoryInput) =>
  stored.name === memory.name &&
  stored.description === memory.description &&
  stored.type === memory.type &&
  stored.body === memory.body &&
  stored.pinned === (memory.pinned ? 1 : 0);

const snapshotVersion = (organizationId: string, slug: string) =>
  db
    .query(
      `INSERT INTO memory_versions (organization_id, slug, name, description, body)
       SELECT organization_id, slug, name, description, body FROM memories WHERE organization_id = ? AND slug = ?`,
    )
    .run(organizationId, slug);

export const listMemories = (
  organizationId: string,
  { query, type, pinned, cursor, limit }: ListMemoriesInput,
  hidden: ReadonlySet<string> = NONE,
): Result<Page<MemoryListItemView>> => {
  const match = query ? toFtsQuery(query, "AND") : null;
  const where = ["m.organization_id = ?", "m.slug NOT IN (SELECT value FROM json_each(?))"];
  const params: SQLQueryBindings[] = [organizationId, hiddenJson(hidden)];
  if (type) {
    where.push("m.type = ?");
    params.push(type);
  }
  if (pinned) {
    where.push("m.pinned = ?");
    params.push(pinned === "true" ? 1 : 0);
  }
  if (match) {
    where.push("memories_fts MATCH ?");
    params.push(match);
  }
  const from = match
    ? "memories m JOIN memories_fts ON memories_fts.organization_id = m.organization_id AND memories_fts.slug = m.slug"
    : "memories m";
  const order = match ? "bm25(memories_fts, 4, 6, 3, 1)" : "m.pinned DESC, m.updated_at DESC";
  return attemptSync(() => {
    const total =
      db
        .query<{ total: number }, SQLQueryBindings[]>(
          `SELECT COUNT(*) AS total FROM ${from} WHERE ${where.join(" AND ")}`,
        )
        .get(...params)?.total ?? 0;
    const rows = db
      .query<MemoryListRow, SQLQueryBindings[]>(
        `SELECT ${MEMORY_LIST_COLUMNS} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, cursor);
    return pageOf(
      rows.map((row) => ({ ...row, pinned: row.pinned === 1 })),
      total,
      cursor,
    );
  }, "STORAGE_FAILED");
};

export const findMemory = (
  organizationId: string,
  slug: string,
  hidden: ReadonlySet<string> = NONE,
): Result<MemoryView> => {
  if (hidden.has(slug)) return memoryDenied(slug);
  const row = attemptSync(
    () =>
      db
        .query<MemoryDetailRow, [string, string]>(
          `SELECT ${MEMORY_LIST_COLUMNS}, m.body, m.created_at AS createdAt,
             (SELECT json_group_array(to_slug) FROM (
               SELECT to_slug FROM memory_links WHERE organization_id = m.organization_id AND from_slug = m.slug
               ORDER BY to_slug)) AS links,
             (SELECT json_group_array(from_slug) FROM (
               SELECT from_slug FROM memory_links WHERE organization_id = m.organization_id AND to_slug = m.slug
               ORDER BY from_slug)) AS backlinks,
             (SELECT json_group_array(to_slug) FROM (
               SELECT l.to_slug FROM memory_links l
               WHERE l.organization_id = m.organization_id AND l.from_slug = m.slug
                 AND NOT EXISTS (SELECT 1 FROM memories t WHERE t.organization_id = l.organization_id AND t.slug = l.to_slug)
               ORDER BY l.to_slug)) AS brokenLinks
           FROM memories m WHERE m.organization_id = ? AND m.slug = ?`,
        )
        .get(organizationId, slug),
    "STORAGE_FAILED",
  );
  if (row.error) return row;
  if (!row.data) return fail("MEMORY_NOT_FOUND", `Memória "${slug}" não encontrada.`);
  const { links, backlinks, brokenLinks, pinned, ...rest } = row.data;
  const visible = (json: string) => (JSON.parse(json) as string[]).filter((other) => !hidden.has(other));
  return attemptSync(() => {
    const view = { links: visible(links), backlinks: visible(backlinks), brokenLinks: visible(brokenLinks) };
    return {
      ...rest,
      pinned: pinned === 1,
      ...view,
      linkCount: view.links.length,
      backlinkCount: view.backlinks.length,
    };
  }, "STORAGE_FAILED");
};

export interface MemoryOwnership {
  visibility: MemoryVisibility;
  ownerKey: string | null;
}

/** Null when the memory does not exist. */
export const findMemoryOwnership = (organizationId: string, slug: string): Result<MemoryOwnership | null> =>
  attemptSync(
    () =>
      db
        .query<MemoryOwnership, [string, string]>(
          "SELECT visibility, owner_key AS ownerKey FROM memories WHERE organization_id = ? AND slug = ?",
        )
        .get(organizationId, slug),
    "STORAGE_FAILED",
  );

export const memoryExists = (organizationId: string, slug: string): Result<boolean> => {
  const row = findMemoryOwnership(organizationId, slug);
  return row.error ? row : ok(row.data !== null);
};

export const insertMemory = (
  organizationId: string,
  input: CreateMemoryInput,
  createdAt: string | null = null,
  ownerKey: string | null = null,
): Result<null> => {
  const written = attemptSync(
    db.transaction(() => {
      const inserted = db
        .query(
          `INSERT INTO memories (organization_id, slug, name, description, type, body, pinned, visibility, owner_key,
             created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ${SQL_NOW}))
           ON CONFLICT(organization_id, slug) DO NOTHING`,
        )
        .run(
          organizationId,
          input.slug,
          input.name,
          input.description,
          input.type,
          input.body,
          input.pinned ? 1 : 0,
          input.visibility ?? "org",
          ownerKey,
          createdAt,
        );
      if (!inserted.changes) return false;
      syncDerived(organizationId, input);
      return true;
    }),
    "STORAGE_FAILED",
  );
  if (written.error) return written;
  return written.data ? ok(null) : fail("ALREADY_EXISTS", `Já existe uma memória "${input.slug}".`);
};

export const updateMemoryRow = (organizationId: string, slug: string, input: UpdateMemoryInput): Result<null> => {
  const written = attemptSync(
    db.transaction(() => {
      snapshotVersion(organizationId, slug);
      const updated = db
        .query<MemoryContent, SQLQueryBindings[]>(
          `UPDATE memories SET
             name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type),
             body = COALESCE(?, body), pinned = COALESCE(?, pinned), visibility = COALESCE(?, visibility),
             updated_at = ${SQL_NOW}
           WHERE organization_id = ? AND slug = ?
           RETURNING slug, name, description, body`,
        )
        .get(
          input.name ?? null,
          input.description ?? null,
          input.type ?? null,
          input.body ?? null,
          input.pinned === undefined ? null : input.pinned ? 1 : 0,
          input.visibility ?? null,
          organizationId,
          slug,
        );
      if (updated) syncDerived(organizationId, updated);
      return updated !== null;
    }),
    "STORAGE_FAILED",
  );
  if (written.error) return written;
  return written.data ? ok(null) : fail("MEMORY_NOT_FOUND", `Memória "${slug}" não encontrada.`);
};

export const deleteMemoryRow = (organizationId: string, slug: string): Result<null> => {
  const deleted = attemptSync(
    db.transaction(() => {
      const removed = db.query("DELETE FROM memories WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
      db.query("DELETE FROM memory_links WHERE organization_id = ? AND from_slug = ?").run(organizationId, slug);
      db.query("DELETE FROM memory_versions WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
      db.query("DELETE FROM memories_fts WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
      return removed.changes;
    }),
    "STORAGE_FAILED",
  );
  if (deleted.error) return deleted;
  return deleted.data ? ok(null) : fail("MEMORY_NOT_FOUND", `Memória "${slug}" não encontrada.`);
};

export const listVersions = (organizationId: string, slug: string): Result<MemoryVersionView[]> =>
  attemptSync(
    () =>
      db
        .query<MemoryVersionView, [string, string]>(
          `SELECT id, name, description, body, created_at AS createdAt FROM memory_versions
           WHERE organization_id = ? AND slug = ? ORDER BY id DESC`,
        )
        .all(organizationId, slug),
    "STORAGE_FAILED",
  );

export const describeHealth = (
  organizationId: string,
  staleDays: number,
  hidden: ReadonlySet<string> = NONE,
): Result<MemoryHealthView> =>
  attemptSync(() => {
    const shown = (ref: MemoryRefView) => !hidden.has(ref.slug);
    const stale = db
      .query<MemoryRefView, [string, string]>(
        `SELECT ${MEMORY_REF_COLUMNS} FROM memories m
         WHERE m.organization_id = ? AND m.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         ORDER BY m.updated_at`,
      )
      .all(organizationId, `-${staleDays} days`);
    const brokenLinks = db
      .query<{ from: string; to: string }, [string]>(
        `SELECT l.from_slug AS "from", l.to_slug AS "to" FROM memory_links l
         WHERE l.organization_id = ?
           AND NOT EXISTS (SELECT 1 FROM memories t WHERE t.organization_id = l.organization_id AND t.slug = l.to_slug)
         ORDER BY l.from_slug, l.to_slug`,
      )
      .all(organizationId);
    const isolated = db
      .query<MemoryRefView, [string]>(
        `SELECT ${MEMORY_REF_COLUMNS} FROM memories m
         WHERE m.organization_id = ?
           AND NOT EXISTS (SELECT 1 FROM memory_links l WHERE l.organization_id = m.organization_id AND l.from_slug = m.slug)
           AND NOT EXISTS (SELECT 1 FROM memory_links l WHERE l.organization_id = m.organization_id AND l.to_slug = m.slug)
         ORDER BY m.name`,
      )
      .all(organizationId);
    const total =
      db
        .query<{ total: number }, [string, string]>(
          "SELECT COUNT(*) AS total FROM memories WHERE organization_id = ? AND slug NOT IN (SELECT value FROM json_each(?))",
        )
        .get(organizationId, hiddenJson(hidden))?.total ?? 0;
    return {
      staleDays,
      stale: stale.filter(shown),
      brokenLinks: brokenLinks.filter((link) => !hidden.has(link.from)),
      isolated: isolated.filter(shown),
      total,
    };
  }, "STORAGE_FAILED");

export const describeGraph = (organizationId: string, hidden: ReadonlySet<string> = NONE): Result<MemoryGraphView> =>
  attemptSync(() => {
    const nodes = db
      .query<MemoryGraphNodeRow, [string, string]>(
        `WITH ${MEMORY_GRAPH_EDGES},
         ends AS (SELECT source AS slug FROM edges UNION ALL SELECT target FROM edges),
         degrees AS (SELECT slug, COUNT(*) AS degree FROM ends GROUP BY slug)
         SELECT m.slug, m.name, m.type, m.pinned, COALESCE(d.degree, 0) AS degree
         FROM memories m LEFT JOIN degrees d ON d.slug = m.slug
         WHERE m.organization_id = ? ORDER BY m.slug`,
      )
      .all(organizationId, organizationId);
    const edges = db
      .query<MemoryGraphEdgeView, [string]>(
        `WITH ${MEMORY_GRAPH_EDGES} SELECT source, target FROM edges ORDER BY source, target`,
      )
      .all(organizationId);
    if (hidden.size === 0) return { nodes: nodes.map((node) => ({ ...node, pinned: node.pinned === 1 })), edges };
    const shownEdges = edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target));
    const degree = (slug: string) => shownEdges.filter((edge) => edge.source === slug || edge.target === slug).length;
    return {
      nodes: nodes
        .filter((node) => !hidden.has(node.slug))
        .map((node) => ({ ...node, pinned: node.pinned === 1, degree: degree(node.slug) })),
      edges: shownEdges,
    };
  }, "STORAGE_FAILED");

export interface MemoryWriter {
  hidden: ReadonlySet<string>;
  owner: string | null;
}

const PANEL_WRITER: MemoryWriter = { hidden: NONE, owner: null };

/** New rows default to private when a named key writes them; existing rows keep their visibility. */
export const upsertMemories = (
  organizationId: string,
  memories: ImportedMemoryInput[],
  writer: MemoryWriter = PANEL_WRITER,
): Result<ImportResultView> =>
  attemptSync(
    db.transaction(() => {
      const stored = db.query<StoredMemoryRow, [string, string]>(
        `SELECT name, description, type, body, pinned, updated_at AS updatedAt FROM memories
         WHERE organization_id = ? AND slug = ?`,
      );
      const version = db.query(
        `INSERT INTO memory_versions (organization_id, slug, name, description, body)
         SELECT organization_id, slug, name, description, body FROM memories
         WHERE organization_id = ? AND slug = ? AND (name <> ? OR description <> ? OR body <> ?)`,
      );
      const upsert = db.query(
        `INSERT INTO memories (organization_id, slug, name, description, type, body, pinned, visibility, owner_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, slug) DO UPDATE SET
           name = excluded.name, description = excluded.description, type = excluded.type, body = excluded.body,
           pinned = excluded.pinned, updated_at = ${SQL_NOW}`,
      );
      const skipped: string[] = [];
      const unchanged: string[] = [];
      for (const memory of memories) {
        const current = stored.get(organizationId, memory.slug);
        const visibility = memory.visibility ?? (writer.owner ? "private" : "org");
        if (writer.hidden.has(memory.slug) || (!current && visibility === "private" && !writer.owner)) {
          skipped.push(memory.slug);
          continue;
        }
        if (current && isSameMemory(current, memory)) {
          unchanged.push(memory.slug);
          continue;
        }
        if (isStoredNewer(current?.updatedAt, memory.updatedAt)) {
          skipped.push(memory.slug);
          continue;
        }
        version.run(organizationId, memory.slug, memory.name, memory.description, memory.body);
        upsert.run(
          organizationId,
          memory.slug,
          memory.name,
          memory.description,
          memory.type,
          memory.body,
          memory.pinned ? 1 : 0,
          visibility,
          writer.owner,
        );
        syncDerived(organizationId, memory);
      }
      const written = memories.length - skipped.length - unchanged.length;
      return { imported: written + unchanged.length, written, skipped, unchanged };
    }),
    "STORAGE_FAILED",
  );
