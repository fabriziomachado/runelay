export const MEMORY_LIST_COLUMNS = `m.slug, m.name, m.description, m.type, m.pinned, m.visibility, m.owner_key AS ownerKey,
  m.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM memory_links l WHERE l.organization_id = m.organization_id AND l.from_slug = m.slug) AS linkCount,
  (SELECT COUNT(*) FROM memory_links l WHERE l.organization_id = m.organization_id AND l.to_slug = m.slug) AS backlinkCount`;

export const MEMORY_GRAPH_EDGES = `edges AS (
  SELECT l.from_slug AS source, l.to_slug AS target FROM memory_links l
  JOIN memories s ON s.organization_id = l.organization_id AND s.slug = l.from_slug
  JOIN memories t ON t.organization_id = l.organization_id AND t.slug = l.to_slug
  WHERE l.organization_id = ?)`;

export const MEMORY_REF_COLUMNS = "m.slug, m.name, m.updated_at AS updatedAt";

export const SIMILAR_LIMIT = 3;

export const SIMILAR_TOKEN = /[\p{L}\p{N}_]{4,}/gu;

export const SIMILAR_HINT =
  "Similar memories already exist: if one of them covers this subject, update it with write_memory instead of keeping a duplicate.";
