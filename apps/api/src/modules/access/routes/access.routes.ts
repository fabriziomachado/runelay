import { type ResourceType, updateResourceAccessSchema } from "@runelay/shared";
import { Hono } from "hono";
import { findResourceAccess, updateResourceAccess } from "@/modules/access/services/access.service";
import { requireSession } from "@/modules/auth/middlewares/authenticate";
import { respond } from "@/shared/http";
import type { SessionEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

const resourceRoutes = (type: ResourceType) =>
  new Hono<SessionEnv>()
    .use(requireSession)
    .get("/:id", (c) => respond(c, findResourceAccess(c.var.organizationId, type, c.req.param("id"))))
    .put("/:id", validate("json", updateResourceAccessSchema), (c) =>
      respond(c, updateResourceAccess(c.var.organizationId, type, c.req.param("id"), c.req.valid("json"))),
    );

export const accessRoutes = new Hono()
  .route("/sources", resourceRoutes("source"))
  .route("/skills", resourceRoutes("skill"));
