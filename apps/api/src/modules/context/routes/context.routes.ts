import { contextBriefSchema, contextSearchSchema, ok, type Result } from "@runelay/shared";
import { Hono } from "hono";
import { hiddenResourcesFor, memoryScopeFor } from "@/modules/access/services/access.service";
import type { AccessCaller } from "@/modules/access/types/access.types";
import { requireOrganization } from "@/modules/auth/middlewares/authenticate";
import { buildBrief, searchContext } from "@/modules/context/services/context.service";
import { respond } from "@/shared/http";
import type { AppEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

interface HiddenContext {
  skills: ReadonlySet<string>;
  memories: ReadonlySet<string>;
}

const hiddenContextFor = (caller: AccessCaller): Result<HiddenContext> => {
  const hidden = hiddenResourcesFor(caller);
  if (hidden.error) return hidden;
  const scope = memoryScopeFor(caller);
  return scope.error ? scope : ok({ skills: hidden.data.skill, memories: scope.data.hidden });
};

export const contextRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .get("/search", validate("query", contextSearchSchema), (c) => {
    const hidden = hiddenContextFor(c.var);
    return respond(
      c,
      hidden.error
        ? hidden
        : searchContext(c.var.organizationId, c.req.valid("query"), hidden.data.skills, hidden.data.memories),
    );
  })
  .get("/brief", validate("query", contextBriefSchema), (c) => {
    const hidden = hiddenContextFor(c.var);
    return respond(
      c,
      hidden.error
        ? hidden
        : buildBrief(c.var.organizationId, c.req.valid("query").client, hidden.data.skills, hidden.data.memories),
    );
  });
