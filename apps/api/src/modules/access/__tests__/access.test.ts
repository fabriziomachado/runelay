import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ResourceAccessView } from "@runelay/shared";
import { env } from "@/config/env";
import { db } from "@/db/connection";
import {
  ensureAccess,
  ensureCanIssueAgentKey,
  findResourceAccess,
  hiddenResourcesFor,
  pruneOrphanGrants,
  updateResourceAccess,
} from "@/modules/access/services/access.service";
import { withQueryFault, withQueryFaultAsync } from "../../../../test/db-fault-helpers";
import { connectGateway, startMcpUpstream, textOf } from "../../../../test/gateway-helpers";
import { body, call, createApiKey, resetDatabase, signUp, type TestAccount } from "../../../../test/helpers";

const upstream = startMcpUpstream();
const previousAllowPrivate = env.RUNELAY_ALLOW_PRIVATE_URLS;
const previousEnableExecute = env.RUNELAY_ENABLE_EXECUTE;

let account: TestAccount;
let alpha: { id: string; key: string };
let beta: { id: string; key: string };
let alphaGateway: Client;
let betaGateway: Client;

const HIDDEN_QUERY = (sql: string) => sql.includes("resource_access a WHERE");

const put = (path: string, json: unknown, cookie = account.cookie) =>
  call(`/v1/access${path}`, { method: "PUT", cookie, json });

const tool = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = textOf(result);
  return { isError: result.isError === true, text, json: () => JSON.parse(text) as Record<string, unknown> };
};

const grants = (type: string, id: string) =>
  db
    .query<{ key_name: string }, [string, string, string]>(
      "SELECT key_name FROM resource_access WHERE organization_id = ? AND resource_type = ? AND resource_id = ?",
    )
    .all(account.organizationId, type, id)
    .map((row) => row.key_name);

beforeAll(async () => {
  env.RUNELAY_ALLOW_PRIVATE_URLS = true;
  env.RUNELAY_ENABLE_EXECUTE = true;
  resetDatabase();
  account = await signUp("Access");
  alpha = await createApiKey(account, "alpha");
  beta = await createApiKey(account, "beta");
  for (const name of ["remote", "public"]) {
    const response = await call("/v1/sources", {
      method: "POST",
      cookie: account.cookie,
      json: { name, config: { kind: "mcp", url: upstream.url("/mcp") } },
    });
    expect(response.status).toBe(201);
  }
  for (const slug of ["secret-recipe", "open-recipe"]) {
    const response = await call("/v1/skills", {
      method: "POST",
      cookie: account.cookie,
      json: {
        slug,
        name: slug,
        description: `Recipe ${slug}`,
        body: `How to bake the ${slug} cake`,
        files: [{ path: "notes.md", content: "flour" }],
      },
    });
    expect(response.status).toBe(201);
  }
  alphaGateway = await connectGateway(alpha.key);
  betaGateway = await connectGateway(beta.key);
});

afterAll(async () => {
  await alphaGateway.close();
  await betaGateway.close();
  env.RUNELAY_ALLOW_PRIVATE_URLS = previousAllowPrivate;
  env.RUNELAY_ENABLE_EXECUTE = previousEnableExecute;
  upstream.server.stop(true);
});

describe("access routes", () => {
  test("defaults to the whole organization", async () => {
    const response = await call("/v1/access/sources/remote", { cookie: account.cookie });
    expect(response.status).toBe(200);
    expect((await body<ResourceAccessView>(response)).data).toEqual({
      type: "source",
      id: "remote",
      visibility: "org",
      keyNames: [],
    });
  });

  test("restricts a connector and a skill to selected keys", async () => {
    const source = await put("/sources/remote", { visibility: "restricted", keyNames: ["alpha", " alpha "] });
    expect(source.status).toBe(200);
    expect((await body<ResourceAccessView>(source)).data).toMatchObject({
      visibility: "restricted",
      keyNames: ["alpha"],
    });
    const skill = await put("/skills/secret-recipe", { visibility: "restricted", keyNames: ["alpha"] });
    expect((await body<ResourceAccessView>(skill)).data.keyNames).toEqual(["alpha"]);
  });

  test("rejects unknown keys and missing resources", async () => {
    const unknown = await put("/sources/remote", { visibility: "restricted", keyNames: ["ghost"] });
    expect(unknown.status).toBe(400);
    expect((await body(unknown)).error?.message).toContain("ghost");
    expect((await call("/v1/access/sources/nope", { cookie: account.cookie })).status).toBe(404);
    expect((await call("/v1/access/skills/nope", { cookie: account.cookie })).status).toBe(404);
    expect((await put("/skills/nope", { visibility: "org" })).status).toBe(404);
  });

  test("only a panel session can read or change access", async () => {
    const response = await call("/v1/access/sources/remote", {
      method: "PUT",
      bearer: beta.key,
      json: { visibility: "org" },
    });
    expect(response.status).toBe(401);
    expect((await call("/v1/access/sources/remote", { bearer: alpha.key })).status).toBe(401);
  });

  test("switching back to the organization clears the grants", async () => {
    await put("/sources/public", { visibility: "restricted", keyNames: ["beta"] });
    expect(grants("source", "public")).toEqual(["beta"]);
    const response = await put("/sources/public", { visibility: "org", keyNames: ["beta"] });
    expect((await body<ResourceAccessView>(response)).data).toMatchObject({ visibility: "org", keyNames: [] });
    expect(grants("source", "public")).toEqual([]);
  });
});

describe("gateway filtering per key", () => {
  test("list_connections hides restricted connectors", async () => {
    const names = (client: Client) =>
      tool(client, "list_connections").then((result) =>
        (JSON.parse(result.text) as { name: string }[]).map((view) => view.name),
      );
    expect(await names(alphaGateway)).toEqual(["public", "remote"]);
    expect(await names(betaGateway)).toEqual(["public"]);
  });

  test("search_tools only returns tools from allowed connectors", async () => {
    const sources = async (client: Client) => {
      const result = await tool(client, "search_tools", { query: "echo" });
      return [...new Set((JSON.parse(result.text) as { name: string }[]).map((item) => item.name.split(".")[0]))];
    };
    expect((await sources(alphaGateway)).sort()).toEqual(["public", "remote"]);
    expect(await sources(betaGateway)).toEqual(["public"]);
    const scoped = await tool(betaGateway, "search_tools", { source: "remote" });
    expect(JSON.parse(scoped.text)).toEqual([]);
  });

  test("call_tool denies a hidden connector with a clear error", async () => {
    const allowed = await tool(alphaGateway, "call_tool", { name: "remote.echo", args: { n: 1 } });
    expect(allowed.isError).toBe(false);
    const denied = await tool(betaGateway, "call_tool", { name: "remote.echo", args: { n: 1 } });
    expect(denied.isError).toBe(true);
    expect(denied.json()).toMatchObject({ error: { code: "ACCESS_DENIED" } });
    expect(denied.text).toContain("remote");
    const open = await tool(betaGateway, "call_tool", { name: "public.echo", args: { n: 2 } });
    expect(open.isError).toBe(false);
  });

  test("execute cannot reach a hidden connector", async () => {
    const code = "return { remote: typeof tools.remote, public: typeof tools.public };";
    expect((await tool(alphaGateway, "execute", { code })).json()).toMatchObject({
      result: { remote: "object", public: "object" },
    });
    expect((await tool(betaGateway, "execute", { code })).json()).toMatchObject({
      result: { remote: "undefined", public: "object" },
    });
    const bypass = await tool(betaGateway, "execute", { code: "return await tools.remote.echo({});" });
    expect(bypass.isError).toBe(true);
  });

  test("read_skill and read_skill_file respect skill access", async () => {
    expect((await tool(alphaGateway, "read_skill", { slug: "secret-recipe" })).isError).toBe(false);
    const denied = await tool(betaGateway, "read_skill", { slug: "secret-recipe" });
    expect(denied.json()).toMatchObject({ error: { code: "ACCESS_DENIED" } });
    expect((await tool(betaGateway, "read_skill", { slug: "open-recipe" })).isError).toBe(false);
    const file = await tool(betaGateway, "read_skill_file", { slug: "secret-recipe", path: "notes.md" });
    expect(file.json()).toMatchObject({ error: { code: "ACCESS_DENIED" } });
    expect((await tool(alphaGateway, "read_skill_file", { slug: "secret-recipe", path: "notes.md" })).isError).toBe(
      false,
    );
  });

  test("write_skill and write_skill_file cannot overwrite a hidden skill", async () => {
    const write = await tool(betaGateway, "write_skill", { slug: "secret-recipe", name: "x", body: "hijacked" });
    expect(write.json()).toMatchObject({ error: { code: "ACCESS_DENIED" } });
    const file = await tool(betaGateway, "write_skill_file", { slug: "secret-recipe", path: "x.md", content: "x" });
    expect(file.json()).toMatchObject({ error: { code: "ACCESS_DENIED" } });
    const own = await tool(betaGateway, "write_skill", { slug: "beta-notes", name: "Beta notes", body: "mine" });
    expect(own.isError).toBe(false);
  });

  test("search_context and the REST context only show allowed skills", async () => {
    const slugs = async (client: Client) => {
      const result = await tool(client, "search_context", { query: "cake", kind: "skill" });
      return (JSON.parse(result.text) as { slug: string }[]).map((hit) => hit.slug).sort();
    };
    expect(await slugs(alphaGateway)).toEqual(["open-recipe", "secret-recipe"]);
    expect(await slugs(betaGateway)).toEqual(["open-recipe"]);
    const search = await call("/v1/context/search?query=cake", { bearer: beta.key });
    expect(JSON.stringify((await body(search)).data)).not.toContain("secret-recipe");
    const brief = await call("/v1/context/brief?client=claude", { bearer: beta.key });
    const briefText = JSON.stringify((await body(brief)).data);
    expect(briefText).toContain("open-recipe");
    expect(briefText).not.toContain("secret-recipe");
    const panel = await call("/v1/context/brief?client=claude", { cookie: account.cookie });
    expect(JSON.stringify((await body(panel)).data)).toContain("secret-recipe");
  });

  test("storage failures surface as errors instead of leaking", async () => {
    await withQueryFaultAsync(HIDDEN_QUERY, async () => {
      for (const [name, args] of [
        ["list_connections", {}],
        ["search_tools", {}],
        ["call_tool", { name: "public.echo" }],
        ["execute", { code: "return 1;" }],
        ["search_context", { query: "cake" }],
        ["read_skill", { slug: "open-recipe" }],
      ] as const) {
        const result = await tool(betaGateway, name, args);
        expect(result.isError).toBe(true);
        expect(result.json()).toMatchObject({ error: { code: "STORAGE_FAILED" } });
      }
      expect((await call("/v1/context/search?query=cake", { bearer: beta.key })).status).toBe(500);
      expect((await call("/v1/context/brief?client=claude", { bearer: beta.key })).status).toBe(500);
    });
  });
});

describe("grant lifecycle", () => {
  test("renaming a connector keeps its grants", async () => {
    await put("/sources/public", { visibility: "restricted", keyNames: ["beta"] });
    const response = await call("/v1/sources/public", {
      method: "PATCH",
      cookie: account.cookie,
      json: { name: "shared" },
    });
    expect(response.status).toBe(200);
    expect(grants("source", "shared")).toEqual(["beta"]);
    expect(grants("source", "public")).toEqual([]);
  });

  test("deleting a connector or skill drops its grants", async () => {
    expect((await call("/v1/sources/shared", { method: "DELETE", cookie: account.cookie })).status).toBe(200);
    expect(grants("source", "shared")).toEqual([]);
    await put("/skills/open-recipe", { visibility: "restricted", keyNames: ["beta"] });
    expect((await call("/v1/skills/open-recipe", { method: "DELETE", cookie: account.cookie })).status).toBe(200);
    expect(grants("skill", "open-recipe")).toEqual([]);
  });

  test("another key cannot rotate into a name that holds grants", async () => {
    const response = await call("/v1/api-keys/agent", { method: "POST", bearer: beta.key, json: { name: "alpha" } });
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe("ACCESS_DENIED");
    const fresh = await call("/v1/api-keys/agent", { method: "POST", bearer: beta.key, json: { name: "gamma" } });
    expect(fresh.status).toBe(201);
  });

  test("a key can rotate itself and keep its grants", async () => {
    const response = await call("/v1/api-keys/agent", { method: "POST", bearer: alpha.key, json: { name: "alpha" } });
    expect(response.status).toBe(201);
    const rotated = (await body<{ id: string; key: string }>(response)).data;
    expect(grants("source", "remote")).toEqual(["alpha"]);
    const client = await connectGateway(rotated.key);
    expect((await tool(client, "call_tool", { name: "remote.echo" })).isError).toBe(false);
    await client.close();
    alpha = rotated;
  });

  test("deleting a key prunes its grants", async () => {
    expect((await call(`/v1/api-keys/${alpha.id}`, { method: "DELETE", cookie: account.cookie })).status).toBe(200);
    expect(grants("source", "remote")).toEqual([]);
    expect(grants("skill", "secret-recipe")).toEqual([]);
  });
});

describe("access service", () => {
  test("a panel session hides nothing and an unnamed key sees nothing restricted", async () => {
    const caller = { organizationId: account.organizationId, apiKeyId: null };
    expect(hiddenResourcesFor(caller).data?.source.size).toBe(0);
    const unnamed = hiddenResourcesFor({ organizationId: account.organizationId, apiKeyId: "missing" });
    expect([...(unnamed.data?.source ?? [])]).toEqual(["remote"]);
    expect(
      ensureAccess({ organizationId: account.organizationId, apiKeyId: "missing" }, "source", "remote").error?.code,
    ).toBe("ACCESS_DENIED");
    expect(ensureCanIssueAgentKey({ organizationId: account.organizationId, apiKeyId: null }, "beta").error).toBeNull();
  });

  test("returns STORAGE_FAILED on database faults", () => {
    const org = account.organizationId;
    const caller = { organizationId: org, apiKeyId: beta.id };
    const failsWith = (matches: (sql: string) => boolean, run: () => { error: { code: string } | null }) =>
      expect(withQueryFault(matches, run).error?.code).toBe("STORAGE_FAILED");

    failsWith(
      (sql) => sql.startsWith("SELECT name FROM apikey"),
      () => hiddenResourcesFor(caller),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT name FROM apikey"),
      () => ensureAccess(caller, "skill", "x"),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT visibility"),
      () => findResourceAccess(org, "source", "remote"),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT key_name"),
      () => findResourceAccess(org, "source", "remote"),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT visibility"),
      () => updateResourceAccess(org, "source", "remote", { visibility: "org", keyNames: [] }),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT DISTINCT name"),
      () => updateResourceAccess(org, "source", "remote", { visibility: "org", keyNames: [] }),
    );
    failsWith(
      (sql) => sql.startsWith("UPDATE sources SET visibility"),
      () => updateResourceAccess(org, "source", "remote", { visibility: "org", keyNames: [] }),
    );
    failsWith(
      (sql) => sql.startsWith("SELECT 1 FROM resource_access"),
      () => ensureCanIssueAgentKey(caller, "beta"),
    );
    failsWith(
      (sql) => sql.startsWith("DELETE FROM resource_access WHERE organization_id = ? AND key_name"),
      () => pruneOrphanGrants(org),
    );
    updateResourceAccess(org, "skill", "secret-recipe", { visibility: "restricted", keyNames: ["beta"] });
    failsWith(
      (sql) => sql.startsWith("SELECT name FROM apikey"),
      () => ensureCanIssueAgentKey(caller, "beta"),
    );
  });
});
