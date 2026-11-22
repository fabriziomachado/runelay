import {
  createSkillSchema,
  exportSkillsSchema,
  githubSkillSourceSchema,
  importSkillsSchema,
  installGithubSkillSchema,
  listSkillsSchema,
  updateSkillSchema,
  uploadSkillSchema,
} from "@runelay/shared";
import { Hono } from "hono";
import { z } from "zod";
import { hiddenResourcesFor, withAccess } from "@/modules/access/services/access.service";
import { requireOrganization } from "@/modules/auth/middlewares/authenticate";
import { discoverGithubSkills, installGithubSkill } from "@/modules/skills/services/github-skill.service";
import {
  createSkill,
  deleteSkill,
  exportSkills,
  findSkill,
  findSkillFile,
  importSkills,
  installSkillDocument,
  listSkills,
  updateSkill,
} from "@/modules/skills/services/skill.service";
import { respond } from "@/shared/http";
import type { AppEnv } from "@/shared/types/app.types";
import { validate } from "@/shared/validator";

const skillFileQuerySchema = z.object({ path: z.string().trim().min(1) });

export const skillsRoutes = new Hono<AppEnv>()
  .use(requireOrganization)
  .get("/", validate("query", listSkillsSchema), (c) => {
    const hidden = hiddenResourcesFor(c.var);
    return respond(
      c,
      hidden.error ? hidden : listSkills(c.var.organizationId, c.req.valid("query"), hidden.data.skill),
    );
  })
  .post("/", validate("json", createSkillSchema), (c) =>
    respond(c, createSkill(c.var.organizationId, c.req.valid("json")), 201),
  )
  .post("/export", validate("json", exportSkillsSchema), async (c) => {
    const { slugs } = c.req.valid("json");
    return respond(c, await withAccess(c.var, "skill", slugs, () => exportSkills(c.var.organizationId, slugs)));
  })
  .post("/import", validate("json", importSkillsSchema), async (c) => {
    const input = c.req.valid("json");
    const slugs = input.skills.map((skill) => skill.slug);
    return respond(c, await withAccess(c.var, "skill", slugs, () => importSkills(c.var.organizationId, input)));
  })
  .post("/upload", validate("json", uploadSkillSchema), (c) => {
    const { filename, content } = c.req.valid("json");
    const name = filename.slice(0, filename.lastIndexOf("."));
    return respond(c, installSkillDocument(c.var.organizationId, { filename: name, content }), 201);
  })
  .post("/github/discover", validate("json", githubSkillSourceSchema), async (c) =>
    respond(c, await discoverGithubSkills(c.req.valid("json").source)),
  )
  .post("/github/install", validate("json", installGithubSkillSchema), async (c) => {
    const { source, skill } = c.req.valid("json");
    return respond(c, await installGithubSkill(c.var.organizationId, source, skill), 201);
  })
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    return respond(c, await withAccess(c.var, "skill", [slug], () => findSkill(c.var.organizationId, slug)));
  })
  .patch("/:slug", validate("json", updateSkillSchema), async (c) => {
    const slug = c.req.param("slug");
    return respond(
      c,
      await withAccess(c.var, "skill", [slug], () => updateSkill(c.var.organizationId, slug, c.req.valid("json"))),
    );
  })
  .delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    return respond(c, await withAccess(c.var, "skill", [slug], () => deleteSkill(c.var.organizationId, slug)));
  })
  .get("/:slug/files", validate("query", skillFileQuerySchema), async (c) => {
    const slug = c.req.param("slug");
    const { path } = c.req.valid("query");
    return respond(c, await withAccess(c.var, "skill", [slug], () => findSkillFile(c.var.organizationId, slug, path)));
  });
