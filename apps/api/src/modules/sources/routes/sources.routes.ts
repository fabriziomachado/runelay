import {
  addSourceAccountSchema,
  createSourceSchema,
  detectSourceAuthSchema,
  importSourcesSchema,
  listSourcesSchema,
  ok,
  type Result,
  updateSourceSchema,
} from "@runelay/shared";
import { Hono } from "hono";
import { hiddenResourcesFor, withAccess } from "@/modules/access/services/access.service";
import { requireOrganization } from "@/modules/auth/middlewares/authenticate";
import { startLogin } from "@/modules/oauth/services/oauth.service";
import { detectSourceAuth } from "@/modules/sources/services/auth-detection.service";
import {
  addSourceAccount,
  createSource,
  findSourceView,
  importSources,
  listSourceViews,
  removeSource,
  summarizeSources,
  testSource,
  updateSource,
} from "@/modules/sources/services/source.service";
import { redactView } from "@/modules/sources/utils/redact-config";
import { respond } from "@/shared/http";
import type { AppEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

const actorOf = ({ authMethod, role }: AppEnv["Variables"]) => ({ authMethod, role });

type Vars = AppEnv["Variables"];
const keyOf = (c: { var: Vars; req: { param: (name: "name") => string } }) => ({
  organizationId: c.var.organizationId,
  name: c.req.param("name"),
});
const guarded = <T>(vars: Vars, name: string, run: () => Result<T> | Promise<Result<T>>) =>
  withAccess(vars, "source", [name], run);

export const sourcesRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .get("/", validate("query", listSourcesSchema), (c) => {
    const hidden = hiddenResourcesFor(c.var);
    if (hidden.error) return respond(c, hidden);
    const views = listSourceViews(c.var.organizationId, c.req.valid("query").status);
    if (views.error || c.var.authMethod === "session") return respond(c, views);
    return respond(c, ok(views.data.filter((view) => !hidden.data.source.has(view.name)).map(redactView)));
  })
  .post("/", validate("json", createSourceSchema), async (c) => {
    const input = c.req.valid("json");
    return respond(
      c,
      await guarded(c.var, input.name, () => createSource(c.var.organizationId, input, actorOf(c.var))),
      201,
    );
  })
  .get("/summary", (c) => {
    const hidden = hiddenResourcesFor(c.var);
    return respond(c, hidden.error ? hidden : summarizeSources(c.var.organizationId, hidden.data.source));
  })
  .post("/import", validate("json", importSourcesSchema), async (c) => {
    const hidden = hiddenResourcesFor(c.var);
    if (hidden.error) return respond(c, hidden);
    return respond(
      c,
      await importSources(c.var.organizationId, c.req.valid("json"), actorOf(c.var), hidden.data.source),
    );
  })
  .post("/detect-auth", validate("json", detectSourceAuthSchema), async (c) =>
    respond(c, await detectSourceAuth(c.req.valid("json").url)),
  )
  .get("/:name", async (c) => {
    const view = await guarded(c.var, c.req.param("name"), () => findSourceView(keyOf(c)));
    return respond(c, view.error || c.var.authMethod === "session" ? view : ok(redactView(view.data)));
  })
  .patch("/:name", validate("json", updateSourceSchema), async (c) =>
    respond(
      c,
      await guarded(c.var, c.req.param("name"), () => updateSource(keyOf(c), c.req.valid("json"), actorOf(c.var))),
    ),
  )
  .delete("/:name", async (c) => respond(c, await guarded(c.var, c.req.param("name"), () => removeSource(keyOf(c)))))
  .post("/:name/accounts", validate("json", addSourceAccountSchema), async (c) =>
    respond(
      c,
      await guarded(c.var, c.req.param("name"), () =>
        addSourceAccount(keyOf(c), c.req.valid("json").name, actorOf(c.var)),
      ),
      201,
    ),
  )
  .post("/:name/test", async (c) => respond(c, await guarded(c.var, c.req.param("name"), () => testSource(keyOf(c)))))
  .post("/:name/oauth", async (c) => respond(c, await guarded(c.var, c.req.param("name"), () => startLogin(keyOf(c)))));
