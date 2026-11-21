import { checkAgentKeySchema, createApiKeySchema, paginationSchema } from "@runelay/shared";
import { Hono } from "hono";
import { ensureCanIssueAgentKey, pruneOrphanGrants } from "@/modules/access/services/access.service";
import {
  checkAgentApiKey,
  createApiKey,
  deleteApiKey,
  issueAgentApiKey,
  listApiKeys,
  listKeyActivity,
  revealApiKey,
} from "@/modules/api-keys/services/api-key.service";
import { requireOrganization, requireSession } from "@/modules/auth/middlewares/authenticate";
import { respond, respondError } from "@/shared/http";
import type { AppEnv, SessionEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

const agentKeyRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .post("/", validate("json", createApiKeySchema), async (c) => {
    if (!c.var.apiKeyId) return respondError(c, "API_KEY_REQUIRED");
    const { name } = c.req.valid("json");
    const allowed = ensureCanIssueAgentKey(c.var, name);
    if (allowed.error) return respond(c, allowed);
    return respond(c, await issueAgentApiKey(c.var.organizationId, name), 201);
  })
  .post("/check", validate("json", checkAgentKeySchema), (c) => {
    if (!c.var.apiKeyId) return respondError(c, "API_KEY_REQUIRED");
    const { name, key } = c.req.valid("json");
    return respond(c, checkAgentApiKey(c.var.organizationId, name, key));
  });

const sessionKeyRoutes = new Hono<SessionEnv>()
  .use(requireSession)
  .get("/", (c) => respond(c, listApiKeys(c.var.organizationId)))
  .post("/", validate("json", createApiKeySchema), async (c) =>
    respond(c, await createApiKey(c.var.organizationId, c.var.userId, c.req.valid("json").name), 201),
  )
  .get("/:id/activity", validate("query", paginationSchema), (c) => {
    const { cursor, limit } = c.req.valid("query");
    return respond(c, listKeyActivity(c.var.organizationId, c.req.param("id"), cursor, limit));
  })
  .get("/:id/secret", (c) => respond(c, revealApiKey(c.var.organizationId, c.req.param("id"))))
  .delete("/:id", (c) => {
    const deleted = deleteApiKey(c.var.organizationId, c.req.param("id"));
    return respond(c, deleted.error ? deleted : pruneOrphanGrants(c.var.organizationId));
  });

export const apiKeysRoutes = new Hono().route("/agent", agentKeyRoutes).route("/", sessionKeyRoutes);
