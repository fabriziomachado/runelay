import type { SQLQueryBindings } from "bun:sqlite";
import {
  attemptSync,
  type CreateSkillInput,
  fail,
  type ImportedSkillInput,
  type ImportResultView,
  type ListSkillsInput,
  ok,
  type Page,
  type Result,
  type SkillExportView,
  type SkillFileInput,
  type SkillFileRefView,
  type SkillFileView,
  type SkillListItemView,
  type SkillView,
  type UpdateSkillInput,
} from "@runelay/shared";
import { db } from "@/db/connection";
import { SKILL_LIST_COLUMNS } from "@/modules/skills/constants/skill.constants";
import type { SkillContent, SkillDetailRow, SkillListRow, StoredSkillRow } from "@/modules/skills/types/skill.types";
import { SQL_NOW } from "@/shared/constants/sql.constants";
import { toFtsQuery } from "@/shared/utils/fts-query";
import { pageOf } from "@/shared/utils/page";
import { isStoredNewer } from "@/shared/utils/stored-newer";

const syncSearch = (organizationId: string, { slug, name, description, body }: SkillContent) => {
  db.query("DELETE FROM skills_fts WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
  db.query("INSERT INTO skills_fts (slug, name, description, body, organization_id) VALUES (?, ?, ?, ?, ?)").run(
    slug,
    name,
    description,
    body,
    organizationId,
  );
};

const replaceFiles = (organizationId: string, slug: string, files: SkillFileInput[]) => {
  db.query("DELETE FROM skill_files WHERE organization_id = ? AND skill_slug = ?").run(organizationId, slug);
  const insert = db.query(
    "INSERT OR REPLACE INTO skill_files (organization_id, skill_slug, path, content, size) VALUES (?, ?, ?, ?, ?)",
  );
  for (const file of files) {
    insert.run(organizationId, slug, file.path, file.content, Buffer.byteLength(file.content));
  }
};

const fileKey = (files: SkillFileInput[]) =>
  JSON.stringify(
    [...files].sort((left, right) => left.path.localeCompare(right.path)).map(({ path, content }) => [path, content]),
  );

const isSameSkill = (stored: StoredSkillRow, files: SkillFileInput[], skill: ImportedSkillInput) =>
  stored.name === skill.name &&
  stored.description === skill.description &&
  stored.body === skill.body &&
  stored.enabled === (skill.enabled ? 1 : 0) &&
  fileKey(files) === fileKey(skill.files);

export const listSkills = (
  organizationId: string,
  { query, enabled, cursor, limit }: ListSkillsInput,
  excluded: ReadonlySet<string> = new Set(),
): Result<Page<SkillListItemView>> => {
  const match = query ? toFtsQuery(query, "AND") : null;
  const params: SQLQueryBindings[] = match ? [organizationId, match] : [organizationId];
  const from = match
    ? "skills s JOIN skills_fts ON skills_fts.organization_id = s.organization_id AND skills_fts.slug = s.slug"
    : "skills s";
  const conditions = match ? ["s.organization_id = ?", "skills_fts MATCH ?"] : ["s.organization_id = ?"];
  if (enabled !== undefined) {
    conditions.push("s.enabled = ?");
    params.push(enabled ? 1 : 0);
  }
  if (excluded.size) {
    conditions.push("s.slug NOT IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify([...excluded]));
  }
  const where = conditions.join(" AND ");
  const order = match ? "bm25(skills_fts, 4, 6, 3, 1)" : "s.name";
  return attemptSync(() => {
    const total =
      db
        .query<{ total: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`)
        .get(...params)?.total ?? 0;
    const rows = db
      .query<SkillListRow, SQLQueryBindings[]>(
        `SELECT ${SKILL_LIST_COLUMNS} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, cursor);
    return pageOf(
      rows.map((row) => ({ ...row, enabled: row.enabled === 1 })),
      total,
      cursor,
    );
  }, "STORAGE_FAILED");
};

export const findSkill = (organizationId: string, slug: string): Result<SkillView> => {
  const row = attemptSync(
    () =>
      db
        .query<SkillDetailRow, [string, string]>(
          `SELECT ${SKILL_LIST_COLUMNS}, s.body, s.created_at AS createdAt,
             (SELECT json_group_array(json_object('path', path, 'size', size)) FROM (
               SELECT path, size FROM skill_files WHERE organization_id = s.organization_id AND skill_slug = s.slug
               ORDER BY path)) AS files
           FROM skills s WHERE s.organization_id = ? AND s.slug = ?`,
        )
        .get(organizationId, slug),
    "STORAGE_FAILED",
  );
  if (row.error) return row;
  if (!row.data) return fail("SKILL_NOT_FOUND", `Habilidade "${slug}" não encontrada.`);
  const { files, enabled, ...rest } = row.data;
  return attemptSync(
    () => ({ ...rest, enabled: enabled === 1, files: JSON.parse(files) as SkillFileRefView[] }),
    "STORAGE_FAILED",
  );
};

export const exportSkills = (organizationId: string, slugs: string[]): Result<SkillExportView[]> =>
  attemptSync(() => {
    const placeholders = slugs.map(() => "?").join(", ");
    const rows = db
      .query<Omit<SkillDetailRow, "files">, SQLQueryBindings[]>(
        `SELECT ${SKILL_LIST_COLUMNS}, s.body, s.created_at AS createdAt
         FROM skills s WHERE s.organization_id = ? AND s.slug IN (${placeholders}) ORDER BY s.slug`,
      )
      .all(organizationId, ...slugs);
    const files = db
      .query<SkillFileView & { slug: string }, SQLQueryBindings[]>(
        `SELECT skill_slug AS slug, path, content FROM skill_files
         WHERE organization_id = ? AND skill_slug IN (${placeholders}) ORDER BY path`,
      )
      .all(organizationId, ...slugs);
    return rows.map(({ enabled, ...rest }) => ({
      ...rest,
      enabled: enabled === 1,
      files: files.filter((file) => file.slug === rest.slug).map(({ path, content }) => ({ path, content })),
    }));
  }, "STORAGE_FAILED");

export const findSkillFile = (organizationId: string, slug: string, path: string): Result<SkillFileView> => {
  const row = attemptSync(
    () =>
      db
        .query<SkillFileView, [string, string, string]>(
          "SELECT path, content FROM skill_files WHERE organization_id = ? AND skill_slug = ? AND path = ?",
        )
        .get(organizationId, slug, path),
    "STORAGE_FAILED",
  );
  if (row.error) return row;
  return row.data ? ok(row.data) : fail("SKILL_FILE_NOT_FOUND", `Arquivo "${path}" não encontrado em "${slug}".`);
};

export const skillExists = (organizationId: string, slug: string): Result<boolean> => {
  const row = attemptSync(
    () => db.query("SELECT 1 FROM skills WHERE organization_id = ? AND slug = ?").get(organizationId, slug),
    "STORAGE_FAILED",
  );
  return row.error ? row : ok(row.data !== null);
};

export const upsertSkillFile = (
  organizationId: string,
  slug: string,
  { path, content }: SkillFileInput,
): Result<null> => {
  const written = attemptSync(
    db.transaction(() => {
      const touched = db
        .query(`UPDATE skills SET updated_at = ${SQL_NOW} WHERE organization_id = ? AND slug = ?`)
        .run(organizationId, slug);
      if (!touched.changes) return false;
      db.query(
        "INSERT OR REPLACE INTO skill_files (organization_id, skill_slug, path, content, size) VALUES (?, ?, ?, ?, ?)",
      ).run(organizationId, slug, path, content, Buffer.byteLength(content));
      return true;
    }),
    "STORAGE_FAILED",
  );
  if (written.error) return written;
  return written.data ? ok(null) : fail("SKILL_NOT_FOUND", `Habilidade "${slug}" não encontrada.`);
};

export const insertSkill = (organizationId: string, input: CreateSkillInput): Result<null> => {
  const written = attemptSync(
    db.transaction(() => {
      const inserted = db
        .query(
          `INSERT INTO skills (organization_id, slug, name, description, body, enabled) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(organization_id, slug) DO NOTHING`,
        )
        .run(organizationId, input.slug, input.name, input.description, input.body, input.enabled ? 1 : 0);
      if (!inserted.changes) return false;
      replaceFiles(organizationId, input.slug, input.files);
      syncSearch(organizationId, input);
      return true;
    }),
    "STORAGE_FAILED",
  );
  if (written.error) return written;
  return written.data ? ok(null) : fail("ALREADY_EXISTS", `Já existe uma habilidade "${input.slug}".`);
};

export const updateSkillRow = (organizationId: string, slug: string, input: UpdateSkillInput): Result<null> => {
  const written = attemptSync(
    db.transaction(() => {
      const updated = db
        .query<SkillContent, SQLQueryBindings[]>(
          `UPDATE skills SET
             name = COALESCE(?, name), description = COALESCE(?, description), body = COALESCE(?, body),
             enabled = COALESCE(?, enabled), updated_at = ${SQL_NOW}
           WHERE organization_id = ? AND slug = ?
           RETURNING slug, name, description, body`,
        )
        .get(
          input.name ?? null,
          input.description ?? null,
          input.body ?? null,
          input.enabled === undefined ? null : input.enabled ? 1 : 0,
          organizationId,
          slug,
        );
      if (!updated) return false;
      if (input.files) replaceFiles(organizationId, slug, input.files);
      syncSearch(organizationId, updated);
      return true;
    }),
    "STORAGE_FAILED",
  );
  if (written.error) return written;
  return written.data ? ok(null) : fail("SKILL_NOT_FOUND", `Habilidade "${slug}" não encontrada.`);
};

export const deleteSkillRow = (organizationId: string, slug: string): Result<null> => {
  const deleted = attemptSync(
    db.transaction(() => {
      const removed = db.query("DELETE FROM skills WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
      db.query("DELETE FROM skill_files WHERE organization_id = ? AND skill_slug = ?").run(organizationId, slug);
      db.query("DELETE FROM skills_fts WHERE organization_id = ? AND slug = ?").run(organizationId, slug);
      db.query(
        "DELETE FROM resource_access WHERE organization_id = ? AND resource_type = 'skill' AND resource_id = ?",
      ).run(organizationId, slug);
      return removed.changes;
    }),
    "STORAGE_FAILED",
  );
  if (deleted.error) return deleted;
  return deleted.data ? ok(null) : fail("SKILL_NOT_FOUND", `Habilidade "${slug}" não encontrada.`);
};

export const upsertSkills = (organizationId: string, skills: ImportedSkillInput[]): Result<ImportResultView> =>
  attemptSync(
    db.transaction(() => {
      const stored = db.query<StoredSkillRow, [string, string]>(
        `SELECT name, description, body, enabled, updated_at AS updatedAt FROM skills
         WHERE organization_id = ? AND slug = ?`,
      );
      const storedFiles = db.query<SkillFileInput, [string, string]>(
        "SELECT path, content FROM skill_files WHERE organization_id = ? AND skill_slug = ?",
      );
      const upsert = db.query(
        `INSERT INTO skills (organization_id, slug, name, description, body, enabled) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, slug) DO UPDATE SET
           name = excluded.name, description = excluded.description, body = excluded.body,
           enabled = excluded.enabled, updated_at = ${SQL_NOW}`,
      );
      const skipped: string[] = [];
      const unchanged: string[] = [];
      for (const skill of skills) {
        const current = stored.get(organizationId, skill.slug);
        if (current && isSameSkill(current, storedFiles.all(organizationId, skill.slug), skill)) {
          unchanged.push(skill.slug);
          continue;
        }
        if (isStoredNewer(current?.updatedAt, skill.updatedAt)) {
          skipped.push(skill.slug);
          continue;
        }
        upsert.run(organizationId, skill.slug, skill.name, skill.description, skill.body, skill.enabled ? 1 : 0);
        replaceFiles(organizationId, skill.slug, skill.files);
        syncSearch(organizationId, skill);
      }
      const written = skills.length - skipped.length - unchanged.length;
      return { imported: written + unchanged.length, written, skipped, unchanged };
    }),
    "STORAGE_FAILED",
  );
