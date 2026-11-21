import { SQL_NOW } from "@/shared/constants/sql.constants";

export const MIGRATIONS = [
  `CREATE TABLE sources (
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    oauth TEXT NOT NULL,
    url_hash TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error TEXT,
    tool_count INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    connected_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    PRIMARY KEY (organization_id, name)
  )`,
  "CREATE INDEX sources_url_hash ON sources (organization_id, url_hash)",
  `CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL,
    api_key_id TEXT,
    source TEXT NOT NULL,
    tool TEXT NOT NULL,
    ok INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW})
  )`,
  "CREATE INDEX tool_calls_organization_created ON tool_calls (organization_id, created_at)",
  `CREATE TABLE memories (
    organization_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    body TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    PRIMARY KEY (organization_id, slug)
  )`,
  "CREATE INDEX memories_organization_updated ON memories (organization_id, updated_at)",
  `CREATE TABLE memory_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW})
  )`,
  "CREATE INDEX memory_versions_slug ON memory_versions (organization_id, slug, id)",
  `CREATE TABLE memory_links (
    organization_id TEXT NOT NULL,
    from_slug TEXT NOT NULL,
    to_slug TEXT NOT NULL,
    PRIMARY KEY (organization_id, from_slug, to_slug)
  )`,
  "CREATE INDEX memory_links_to ON memory_links (organization_id, to_slug)",
  `CREATE VIRTUAL TABLE memories_fts USING fts5(
    slug, name, description, body, organization_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,
  `CREATE TABLE skills (
    organization_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    PRIMARY KEY (organization_id, slug)
  )`,
  `CREATE TABLE skill_files (
    organization_id TEXT NOT NULL,
    skill_slug TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (organization_id, skill_slug, path)
  )`,
  `CREATE VIRTUAL TABLE skills_fts USING fts5(
    slug, name, description, body, organization_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,
  `CREATE TABLE IF NOT EXISTS api_key_secrets (
    key_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    sealed TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL,
    api_key_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW})
  )`,
  "CREATE INDEX IF NOT EXISTS audit_events_key_created ON audit_events (api_key_id, created_at)",
  "CREATE INDEX IF NOT EXISTS tool_calls_key_created ON tool_calls (api_key_id, created_at)",
  `CREATE TABLE IF NOT EXISTS cli_auth_requests (
    code TEXT PRIMARY KEY,
    poll_token_hash TEXT NOT NULL UNIQUE,
    device TEXT NOT NULL,
    organization_id TEXT,
    api_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW})
  )`,
  "CREATE INDEX IF NOT EXISTS cli_auth_requests_expires ON cli_auth_requests (expires_at)",
  "ALTER TABLE sources ADD COLUMN visibility TEXT NOT NULL DEFAULT 'org'",
  "ALTER TABLE skills ADD COLUMN visibility TEXT NOT NULL DEFAULT 'org'",
  `CREATE TABLE IF NOT EXISTS resource_access (
    organization_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    key_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    PRIMARY KEY (organization_id, resource_type, resource_id, key_name)
  )`,
  "CREATE INDEX IF NOT EXISTS resource_access_key ON resource_access (organization_id, key_name)",
];
