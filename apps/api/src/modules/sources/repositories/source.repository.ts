import {
  attemptSync,
  type CreateSourceInput,
  fail,
  ok,
  type Result,
  type SourceConfig,
  type SourceStatus,
  type SourcesSummaryView,
  type SourceView,
} from "@runelay/shared";
import { db } from "@/db/connection";
import { CATALOG_BY_URL_HASH, googleSourceUrl } from "@/modules/catalog/constants/catalog.constants";
import { grantedServices } from "@/modules/google/utils/google-scopes";
import type {
  InstalledSourceRow,
  OAuthState,
  Source,
  SourceKey,
  SourceRow,
  SourceStatusUpdate,
  SourceViewRow,
} from "@/modules/sources/types/source.types";
import { hashUrl } from "@/modules/sources/utils/url-hash";
import { SQL_NOW } from "@/shared/constants/sql.constants";
import { seal, unseal } from "@/shared/crypto";

const COLUMNS =
  "organization_id AS organizationId, name, config, oauth, status, error, tool_count AS toolCount, enabled, updated_at AS updatedAt";

const VIEW_SELECT = `SELECT s.name, s.config, s.oauth, s.status, s.error, s.tool_count AS toolCount, s.enabled,
    s.connected_at AS connectedAt, s.updated_at AS updatedAt, json_extract(catalog.value, '$.icon') AS icon,
    json_extract(catalog.value, '$.auth') AS auth, json_extract(catalog.value, '$.tokenUrl') AS tokenUrl
  FROM sources s LEFT JOIN json_each(?) catalog ON catalog.key = s.url_hash`;

const decryptView = ({ oauth: sealedOAuth, ...row }: SourceViewRow): Result<SourceView> => {
  const config = unseal<SourceConfig>(row.config);
  if (config.error) return config;
  const oauth = unseal<OAuthState>(sealedOAuth);
  if (oauth.error) return oauth;
  const view = {
    ...row,
    config: config.data,
    enabled: row.enabled === 1,
    oauthClientId: oauth.data.customClient?.clientId ?? null,
    oauthClientScopes: oauth.data.customClient?.scopes ?? [],
  };
  if (config.data.kind !== "google") return ok(view);
  const granted = oauth.data.google?.scopes ?? [];
  return ok({
    ...view,
    google: { email: oauth.data.google?.email ?? null, grantedServices: grantedServices(granted) },
  });
};

const urlHashOf = (config: SourceConfig) => {
  if (config.kind === "mcp") return hashUrl(config.url);
  return config.kind === "google" ? hashUrl(googleSourceUrl(config.services)) : null;
};

const decrypt = (row: SourceRow): Result<Source> => {
  const config = unseal<SourceConfig>(row.config);
  if (config.error) return config;
  const oauth = unseal<OAuthState>(row.oauth);
  if (oauth.error) return oauth;
  return ok({ ...row, config: config.data, oauth: oauth.data, enabled: row.enabled === 1 });
};

const write = (run: () => unknown): Result<null> => {
  const written = attemptSync(run, "STORAGE_FAILED");
  return written.error ? written : ok(null);
};

export const listSources = (organizationId: string): Result<Source[]> => {
  const rows = attemptSync(
    () =>
      db
        .query<SourceRow, [string]>(`SELECT ${COLUMNS} FROM sources WHERE organization_id = ? ORDER BY name`)
        .all(organizationId),
    "STORAGE_FAILED",
  );
  if (rows.error) return rows;
  const sources: Source[] = [];
  for (const row of rows.data) {
    const source = decrypt(row);
    if (source.error) return source;
    sources.push(source.data);
  }
  return ok(sources);
};

export const listSourceViews = (organizationId: string, status?: SourceStatus): Result<SourceView[]> => {
  const rows = attemptSync(
    () =>
      db
        .query<SourceViewRow, [string, string, string | null, string | null]>(
          `${VIEW_SELECT} WHERE s.organization_id = ? AND (? IS NULL OR s.status = ?) ORDER BY s.name`,
        )
        .all(CATALOG_BY_URL_HASH, organizationId, status ?? null, status ?? null),
    "STORAGE_FAILED",
  );
  if (rows.error) return rows;
  const views: SourceView[] = [];
  for (const row of rows.data) {
    const view = decryptView(row);
    if (view.error) return view;
    views.push(view.data);
  }
  return ok(views);
};

export const summarizeSources = (organizationId: string): Result<SourcesSummaryView> => {
  const summary = attemptSync(
    () =>
      db
        .query<SourcesSummaryView, [string]>(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN enabled = 1 THEN tool_count ELSE 0 END), 0) AS tools,
                  COALESCE(SUM(CASE WHEN enabled = 1 AND status <> 'ok' THEN 1 ELSE 0 END), 0) AS attention
           FROM sources WHERE organization_id = ?`,
        )
        .get(organizationId),
    "STORAGE_FAILED",
  );
  if (summary.error) return summary;
  return ok(summary.data ?? { total: 0, tools: 0, attention: 0 });
};

export const findSourceView = ({ organizationId, name }: SourceKey): Result<SourceView> => {
  const row = attemptSync(
    () =>
      db
        .query<SourceViewRow, [string, string, string]>(`${VIEW_SELECT} WHERE s.organization_id = ? AND s.name = ?`)
        .get(CATALOG_BY_URL_HASH, organizationId, name),
    "STORAGE_FAILED",
  );
  if (row.error) return row;
  if (!row.data) return fail("SOURCE_NOT_FOUND", `Conexão "${name}" não encontrada.`);
  return decryptView(row.data);
};

export const findSource = ({ organizationId, name }: SourceKey): Result<Source> => {
  const row = attemptSync(
    () =>
      db
        .query<SourceRow, [string, string]>(`SELECT ${COLUMNS} FROM sources WHERE organization_id = ? AND name = ?`)
        .get(organizationId, name),
    "STORAGE_FAILED",
  );
  if (row.error) return row;
  if (!row.data) return fail("SOURCE_NOT_FOUND", `Conexão "${name}" não encontrada.`);
  return decrypt(row.data);
};

const INSERT_SQL = "INSERT INTO sources (organization_id, name, config, oauth, url_hash) VALUES (?, ?, ?, ?, ?)";

export const insertSource = (organizationId: string, { name, config }: CreateSourceInput): Result<null> => {
  const saved = attemptSync(
    () =>
      db
        .query(`${INSERT_SQL} ON CONFLICT(organization_id, name) DO NOTHING`)
        .run(organizationId, name, seal(config), seal({}), urlHashOf(config)),
    "STORAGE_FAILED",
  );
  if (saved.error) return saved;
  return saved.data.changes ? ok(null) : fail("ALREADY_EXISTS", `Já existe uma conexão chamada "${name}".`);
};

const UPSERT_SQL = `${INSERT_SQL}
  ON CONFLICT(organization_id, name) DO UPDATE SET config = excluded.config, url_hash = excluded.url_hash,
  updated_at = ${SQL_NOW}`;

export const upsertSources = (organizationId: string, inputs: CreateSourceInput[]): Result<null> =>
  write(
    db.transaction(() => {
      const statement = db.query(UPSERT_SQL);
      for (const { name, config } of inputs) {
        statement.run(organizationId, name, seal(config), seal({}), urlHashOf(config));
      }
    }),
  );

export const upsertSource = (organizationId: string, input: CreateSourceInput): Result<Source> => {
  const saved = upsertSources(organizationId, [input]);
  return saved.error ? saved : findSource({ organizationId, name: input.name });
};

export const updateOAuth = (key: SourceKey, patch: Partial<OAuthState>): Result<null> => {
  const current = findSource(key);
  if (current.error) return current;
  return write(() =>
    db
      .query("UPDATE sources SET oauth = ? WHERE organization_id = ? AND name = ?")
      .run(seal({ ...current.data.oauth, ...patch }), key.organizationId, key.name),
  );
};

export const updateStatus = ({ organizationId, name }: SourceKey, { status, error, toolCount }: SourceStatusUpdate) =>
  write(() =>
    db
      .query(
        `UPDATE sources SET status = ?, error = ?, tool_count = COALESCE(?, tool_count), updated_at = ${SQL_NOW}
         WHERE organization_id = ? AND name = ?`,
      )
      .run(status, error, toolCount ?? null, organizationId, name),
  );

export const markConnected = ({ organizationId, name }: SourceKey) =>
  write(() =>
    db
      .query(`UPDATE sources SET connected_at = ${SQL_NOW} WHERE organization_id = ? AND name = ?`)
      .run(organizationId, name),
  );

export const updateEnabled = ({ organizationId, name }: SourceKey, enabled: boolean) =>
  write(() =>
    db
      .query("UPDATE sources SET enabled = ? WHERE organization_id = ? AND name = ?")
      .run(enabled ? 1 : 0, organizationId, name),
  );

export const renameSource = ({ organizationId, name }: SourceKey, nextName: string) =>
  write(
    db.transaction(() => {
      db.query(`UPDATE sources SET name = ?, updated_at = ${SQL_NOW} WHERE organization_id = ? AND name = ?`).run(
        nextName,
        organizationId,
        name,
      );
      db.query("UPDATE tool_calls SET source = ? WHERE organization_id = ? AND source = ?").run(
        nextName,
        organizationId,
        name,
      );
      db.query(
        "UPDATE resource_access SET resource_id = ? WHERE organization_id = ? AND resource_type = 'source' AND resource_id = ?",
      ).run(nextName, organizationId, name);
    }),
  );

export const deleteSource = ({ organizationId, name }: SourceKey) =>
  write(
    db.transaction(() => {
      db.query("DELETE FROM sources WHERE organization_id = ? AND name = ?").run(organizationId, name);
      db.query(
        "DELETE FROM resource_access WHERE organization_id = ? AND resource_type = 'source' AND resource_id = ?",
      ).run(organizationId, name);
    }),
  );

export const listInstalledByUrlHash = (organizationId: string, hashes: string[]): Result<InstalledSourceRow[]> =>
  attemptSync(
    () =>
      db
        .query<InstalledSourceRow, [string, string]>(
          `SELECT url_hash AS urlHash, MIN(name) AS name, status FROM sources
           WHERE organization_id = ? AND url_hash IN (SELECT value FROM json_each(?))
           GROUP BY url_hash`,
        )
        .all(organizationId, JSON.stringify(hashes)),
    "STORAGE_FAILED",
  );
