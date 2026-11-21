import { contextBriefSchema, contextSearchSchema } from "@runelay/shared";
import { Hono } from "hono";
import { hiddenResourcesFor } from "@/modules/access/services/access.service";
import { requireOrganization } from "@/modules/auth/middlewares/authenticate";
import { buildBrief, searchContext } from "@/modules/context/services/context.service";
import { respond } from "@/shared/http";
import type { AppEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

export const contextRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .get("/search", validate("query", contextSearchSchema), (c) => {
    const hidden = hiddenResourcesFor(c.var);
    return respond(
      c,
      hidden.error ? hidden : searchContext(c.var.organizationId, c.req.valid("query"), hidden.data.skill),
    );
  })
  .get("/brief", validate("query", contextBriefSchema), (c) => {
    const hidden = hiddenResourcesFor(c.var);
    return respond(
      c,
      hidden.error ? hidden : buildBrief(c.var.organizationId, c.req.valid("query").client, hidden.data.skill),
    );
  });
