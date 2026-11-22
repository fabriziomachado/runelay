import { attemptSync, ok, type ResourceType, type ResourceVisibility, type Result } from "@runelay/shared";
import { db } from "@/db/connection";
import type { HiddenResources } from "@/modules/access/types/access.types";

const TABLES: Record<ResourceType, { table: string; id: string }> = {
  source: { table: "sources", id: "name" },
  skill: { table: "skills", id: "slug" },
};

const hiddenSql = (type: ResourceType) => {
  const { table, id } = TABLES[type];
  return `SELECT '${type}' AS type, r.${id} AS id FROM ${table} r
    WHERE r.organization_id = ? AND r.visibility = 'restricted' AND NOT EXISTS (
      SELECT 1 FROM resource_access a WHERE a.organization_id = r.organization_id AND a.resource_type = '${type}'
        AND a.resource_id = r.${id} AND a.key_name = ?)`;
};

const HIDDEN_SQL = `${hiddenSql("source")} UNION ALL ${hiddenSql("skill")}`;

export const findKeyName = (organizationId: string, apiKeyId: string): Result<string | null> => {
  const row = attemptSync(
    () =>
      db
        .query<{ name: string | null }, [string, string]>("SELECT name FROM apikey WHERE referenceId = ? AND id = ?")
        .get(organizationId, apiKeyId),
    "STORAGE_FAILED",
  );
  return row.error ? row : ok(row.data?.name ?? null);
};

export const listHiddenFor = (organizationId: string, keyName: string | null): Result<HiddenResources> => {
  const rows = attemptSync(
    () =>
      db
        .query<{ type: ResourceType; id: string }, (string | null)[]>(HIDDEN_SQL)
        .all(organizationId, keyName, organizationId, keyName),
    "STORAGE_FAILED",
  );
  if (rows.error) return rows;
  const hidden = { source: new Set<string>(), skill: new Set<string>() };
  for (const row of rows.data) hidden[row.type].add(row.id);
  return ok(hidden);
};

export const listHiddenMemories = (organizationId: string, keyName: string | null): Result<Set<string>> => {
  const rows = attemptSync(
    () =>
      db
        .query<{ slug: string }, [string, string | null]>(
          `SELECT slug FROM memories WHERE organization_id = ? AND visibility = 'private' AND owner_key IS NOT ?`,
        )
        .all(organizationId, keyName),
    "STORAGE_FAILED",
  );
  return rows.error ? rows : ok(new Set(rows.data.map((row) => row.slug)));
};

export const findVisibility = (
  organizationId: string,
  type: ResourceType,
  id: string,
): Result<ResourceVisibility | null> => {
  const { table, id: column } = TABLES[type];
  const row = attemptSync(
    () =>
      db
        .query<{ visibility: ResourceVisibility }, [string, string]>(
          `SELECT visibility FROM ${table} WHERE organization_id = ? AND ${column} = ?`,
        )
        .get(organizationId, id),
    "STORAGE_FAILED",
  );
  return row.error ? row : ok(row.data?.visibility ?? null);
};

export const listGrantedKeyNames = (organizationId: string, type: ResourceType, id: string): Result<string[]> => {
  const rows = attemptSync(
    () =>
      db
        .query<{ keyName: string }, [string, string, string]>(
          `SELECT key_name AS keyName FROM resource_access
           WHERE organization_id = ? AND resource_type = ? AND resource_id = ? ORDER BY key_name`,
        )
        .all(organizationId, type, id),
    "STORAGE_FAILED",
  );
  return rows.error ? rows : ok(rows.data.map((row) => row.keyName));
};

export const listOrganizationKeyNames = (organizationId: string): Result<string[]> => {
  const rows = attemptSync(
    () =>
      db
        .query<{ name: string }, [string]>(
          "SELECT DISTINCT name FROM apikey WHERE referenceId = ? AND name IS NOT NULL ORDER BY name",
        )
        .all(organizationId),
    "STORAGE_FAILED",
  );
  return rows.error ? rows : ok(rows.data.map((row) => row.name));
};

export const saveAccess = (
  organizationId: string,
  type: ResourceType,
  id: string,
  visibility: ResourceVisibility,
  keyNames: string[],
): Result<null> => {
  const { table, id: column } = TABLES[type];
  const saved = attemptSync(
    db.transaction(() => {
      db.query(`UPDATE ${table} SET visibility = ? WHERE organization_id = ? AND ${column} = ?`).run(
        visibility,
        organizationId,
        id,
      );
      db.query("DELETE FROM resource_access WHERE organization_id = ? AND resource_type = ? AND resource_id = ?").run(
        organizationId,
        type,
        id,
      );
      if (visibility === "org") return;
      const insert = db.query(
        "INSERT INTO resource_access (organization_id, resource_type, resource_id, key_name) VALUES (?, ?, ?, ?)",
      );
      for (const name of keyNames) insert.run(organizationId, type, id, name);
    }),
    "STORAGE_FAILED",
  );
  return saved.error ? saved : ok(null);
};

export const keyNameHasGrants = (organizationId: string, keyName: string): Result<boolean> => {
  const row = attemptSync(
    () =>
      db
        .query("SELECT 1 FROM resource_access WHERE organization_id = ? AND key_name = ? LIMIT 1")
        .get(organizationId, keyName),
    "STORAGE_FAILED",
  );
  return row.error ? row : ok(row.data !== null);
};

export const pruneOrphanGrants = (organizationId: string): Result<null> => {
  const pruned = attemptSync(
    () =>
      db
        .query(
          `DELETE FROM resource_access WHERE organization_id = ? AND key_name NOT IN (
             SELECT name FROM apikey WHERE referenceId = ? AND name IS NOT NULL)`,
        )
        .run(organizationId, organizationId),
    "STORAGE_FAILED",
  );
  return pruned.error ? pruned : ok(null);
};
