import {
  activityRangeSchema,
  createMemorySchema,
  importMemoriesSchema,
  listMemoriesSchema,
  type Result,
  updateMemorySchema,
} from "@runelay/shared";
import { type Context, Hono } from "hono";
import { memoryScopeFor } from "@/modules/access/services/access.service";
import type { MemoryScope } from "@/modules/access/types/access.types";
import { requireOrganization } from "@/modules/auth/middlewares/authenticate";
import {
  createMemory,
  deleteMemory,
  describeMemoryGraph,
  describeMemoryHealth,
  findMemory,
  importMemories,
  listMemories,
  listMemoryVersions,
  updateMemory,
} from "@/modules/memories/services/memory.service";
import { respond } from "@/shared/http";
import type { AppEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

/** Panel sessions see every memory; an API key only org memories and its own private ones. */
const scoped = <T>(c: Context<AppEnv>, run: (scope: MemoryScope) => Result<T>): Result<T> => {
  const scope = memoryScopeFor(c.var);
  return scope.error ? scope : run(scope.data);
};

export const memoriesRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .get("/", validate("query", listMemoriesSchema), (c) =>
    respond(
      c,
      scoped(c, (scope) => listMemories(c.var.organizationId, c.req.valid("query"), scope)),
    ),
  )
  .post("/", validate("json", createMemorySchema), (c) =>
    respond(
      c,
      scoped(c, (scope) => createMemory(c.var.organizationId, c.req.valid("json"), null, scope)),
      201,
    ),
  )
  .get("/health", validate("query", activityRangeSchema), (c) =>
    respond(
      c,
      scoped(c, (scope) => describeMemoryHealth(c.var.organizationId, c.req.valid("query").days, scope)),
    ),
  )
  .get("/graph", (c) =>
    respond(
      c,
      scoped(c, (scope) => describeMemoryGraph(c.var.organizationId, scope)),
    ),
  )
  .post("/import", validate("json", importMemoriesSchema), (c) =>
    respond(
      c,
      scoped(c, (scope) => importMemories(c.var.organizationId, c.req.valid("json"), scope)),
    ),
  )
  .get("/:slug", (c) =>
    respond(
      c,
      scoped(c, (scope) => findMemory(c.var.organizationId, c.req.param("slug"), scope)),
    ),
  )
  .patch("/:slug", validate("json", updateMemorySchema), async (c) =>
    respond(
      c,
      scoped(c, (scope) => updateMemory(c.var.organizationId, c.req.param("slug"), c.req.valid("json"), scope)),
    ),
  )
  .delete("/:slug", (c) =>
    respond(
      c,
      scoped(c, (scope) => deleteMemory(c.var.organizationId, c.req.param("slug"), scope)),
    ),
  )
  .get("/:slug/versions", (c) =>
    respond(
      c,
      scoped(c, (scope) => listMemoryVersions(c.var.organizationId, c.req.param("slug"), scope)),
    ),
  );
