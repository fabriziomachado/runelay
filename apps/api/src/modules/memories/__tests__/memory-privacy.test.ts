import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ContextBriefView, ContextHitView, MemoryGraphView, MemoryHealthView, MemoryView } from "@runelay/shared";
import { db } from "@/db/connection";
import { withQueryFaultAsync } from "../../../../test/db-fault-helpers";
import { connectGateway, textOf } from "../../../../test/gateway-helpers";
import { body, call, createApiKey, resetDatabase, signUp, type TestAccount } from "../../../../test/helpers";

let account: TestAccount;
let alpha: { id: string; key: string };
let beta: { id: string; key: string };
let ghost: { id: string; key: string };
let alphaGateway: Client;
let betaGateway: Client;

const HIDDEN_MEMORIES = (sql: string) => sql.includes("visibility = 'private' AND owner_key IS NOT");

const tool = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = textOf(result);
  return { isError: result.isError === true, text, json: <T>() => JSON.parse(text) as T };
};

const memories = async (bearer?: string) => {
  const response = await call("/v1/memories", bearer ? { bearer } : { cookie: account.cookie });
  const { data } = await body<{ items: { slug: string }[] }>(response);
  return data.items.map((item) => item.slug).sort();
};

const slugsOf = (hits: ContextHitView[]) => hits.map((hit) => hit.slug).sort();

beforeAll(async () => {
  resetDatabase();
  account = await signUp("Privacy");
  alpha = await createApiKey(account, "alpha");
  beta = await createApiKey(account, "beta");
  ghost = await createApiKey(account, "ghost");
  db.query("UPDATE apikey SET name = NULL WHERE id = ?").run(ghost.id);
  const shared = await call("/v1/memories", {
    method: "POST",
    cookie: account.cookie,
    json: { slug: "shared-note", name: "Shared note", type: "project", body: "Wombats live here, see [[alpha-diary]]" },
  });
  expect(shared.status).toBe(201);
  alphaGateway = await connectGateway(alpha.key);
  betaGateway = await connectGateway(beta.key);
});

afterAll(async () => {
  await alphaGateway.close();
  await betaGateway.close();
});

describe("private memory per key", () => {
  test("a key's new memory is born private to it", async () => {
    const written = await tool(alphaGateway, "write_memory", {
      slug: "alpha-diary",
      name: "Alpha diary",
      body: "Alpha wombats secret, linked to [[shared-note]] and [[missing-page]]",
    });
    expect(written.isError).toBe(false);
    expect(written.json<MemoryView>()).toMatchObject({ visibility: "private", ownerKey: "alpha" });
    const pinned = await call("/v1/memories", {
      method: "POST",
      bearer: alpha.key,
      json: { slug: "alpha-pin", name: "Alpha pin", type: "feedback", body: "Always wombats", pinned: true },
    });
    expect(pinned.status).toBe(201);
    expect((await body<MemoryView>(pinned)).data).toMatchObject({ visibility: "private", ownerKey: "alpha" });
  });

  test("other keys do not see it in lists, reads, links, search, brief, health or graph", async () => {
    expect(await memories(beta.key)).toEqual(["shared-note"]);
    expect(await memories(alpha.key)).toEqual(["alpha-diary", "alpha-pin", "shared-note"]);
    expect(await memories()).toEqual(["alpha-diary", "alpha-pin", "shared-note"]);

    const denied = await tool(betaGateway, "read_memory", { slug: "alpha-diary" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("privada");
    const fromBeta = (await tool(betaGateway, "read_memory", { slug: "shared-note" })).json<MemoryView>();
    expect(fromBeta).toMatchObject({ links: [], backlinks: [], brokenLinks: [], linkCount: 0, backlinkCount: 0 });
    const fromAlpha = (await tool(alphaGateway, "read_memory", { slug: "shared-note" })).json<MemoryView>();
    expect(fromAlpha).toMatchObject({ links: ["alpha-diary"], backlinks: ["alpha-diary"], linkCount: 1 });

    const search = { query: "wombats", kind: "memory" };
    expect(slugsOf((await tool(betaGateway, "search_context", search)).json<ContextHitView[]>())).toEqual([
      "shared-note",
    ]);
    expect(slugsOf((await tool(alphaGateway, "search_context", search)).json<ContextHitView[]>())).toEqual([
      "alpha-diary",
      "alpha-pin",
      "shared-note",
    ]);
    const restSearch = await call("/v1/context/search?query=wombats", { bearer: beta.key });
    expect(slugsOf((await body<ContextHitView[]>(restSearch)).data)).toEqual(["shared-note"]);

    const brief = async (bearer: string) =>
      (await body<ContextBriefView>(await call("/v1/context/brief?client=claude", { bearer }))).data.markdown;
    expect(await brief(beta.key)).not.toContain("alpha-");
    expect(await brief(alpha.key)).toContain("alpha-pin");
    expect(await brief(alpha.key)).toContain("alpha-diary");

    const freshBeta = await connectGateway(beta.key);
    expect(freshBeta.getInstructions()).not.toContain("alpha-pin");
    await freshBeta.close();
    const freshAlpha = await connectGateway(alpha.key);
    expect(freshAlpha.getInstructions()).toContain("alpha-pin");
    await freshAlpha.close();

    const health = (await body<MemoryHealthView>(await call("/v1/memories/health", { bearer: beta.key }))).data;
    expect(health.total).toBe(1);
    expect(health.brokenLinks).toEqual([]);
    const panelHealth = (await body<MemoryHealthView>(await call("/v1/memories/health", { cookie: account.cookie })))
      .data;
    expect(panelHealth.brokenLinks.map((link) => link.from)).toContain("alpha-diary");
    expect([...health.stale, ...health.isolated].map((ref) => ref.slug)).not.toContain("alpha-pin");
    const graph = async (init: { bearer?: string; cookie?: string }) =>
      (await body<MemoryGraphView>(await call("/v1/memories/graph", init))).data;
    expect(await graph({ bearer: beta.key })).toEqual({
      nodes: [expect.objectContaining({ slug: "shared-note", degree: 0 })],
      edges: [],
    });
    expect((await graph({ cookie: account.cookie })).edges).toHaveLength(2);
  });

  test("other keys cannot read, change, delete or overwrite it", async () => {
    for (const [method, path, json] of [
      ["GET", "/v1/memories/alpha-diary", undefined],
      ["GET", "/v1/memories/alpha-diary/versions", undefined],
      ["PATCH", "/v1/memories/alpha-diary", { body: "hijack" }],
      ["DELETE", "/v1/memories/alpha-diary", undefined],
      ["POST", "/v1/memories", { slug: "alpha-diary", name: "x", type: "user", body: "hijack" }],
    ] as const) {
      const response = await call(path, { method, bearer: beta.key, json });
      expect(response.status).toBe(403);
      expect((await body(response)).error?.code).toBe("ACCESS_DENIED");
    }
    expect((await tool(betaGateway, "write_memory", { slug: "alpha-diary", body: "hijack" })).isError).toBe(true);
    const imported = await tool(betaGateway, "import_memory", { items: [{ slug: "alpha-diary", body: "hijack" }] });
    expect(imported.json<{ failed: number }>().failed).toBe(1);
    const restImport = await call("/v1/memories/import", {
      method: "POST",
      bearer: beta.key,
      json: { memories: [{ slug: "alpha-diary", name: "x", type: "user", body: "hijack" }] },
    });
    expect((await body<{ skipped: string[] }>(restImport)).data.skipped).toEqual(["alpha-diary"]);
    const owner = (await tool(alphaGateway, "read_memory", { slug: "alpha-diary" })).json<MemoryView>();
    expect(owner.body).toBe("Alpha wombats secret, linked to [[shared-note]] and [[missing-page]]");
    expect((await call("/v1/memories/alpha-diary/versions", { bearer: alpha.key })).status).toBe(200);
  });

  test("imports by a key are private by default and org on request", async () => {
    const restImport = await call("/v1/memories/import", {
      method: "POST",
      bearer: beta.key,
      json: {
        memories: [
          { slug: "beta-import", name: "Beta import", type: "user", body: "mine" },
          { slug: "beta-public", name: "Beta public", type: "user", body: "ours", visibility: "org" },
        ],
      },
    });
    expect(restImport.status).toBe(200);
    const batch = await tool(betaGateway, "import_memory", { items: [{ slug: "beta-tool", body: "mine too" }] });
    expect(batch.json<{ created: number }>().created).toBe(1);
    expect(await memories(alpha.key)).toEqual(["alpha-diary", "alpha-pin", "beta-public", "shared-note"]);
    expect(await memories(beta.key)).toEqual(["beta-import", "beta-public", "beta-tool", "shared-note"]);
    const alphaGraph = (await body<MemoryGraphView>(await call("/v1/memories/graph", { bearer: alpha.key }))).data;
    expect(alphaGraph.nodes.map((node) => node.slug)).not.toContain("beta-import");
    expect(alphaGraph.nodes.find((node) => node.slug === "shared-note")?.degree).toBe(2);
  });
});

describe("visibility changes", () => {
  test("a key opts into org, and only the owner changes visibility", async () => {
    const shared = await tool(alphaGateway, "write_memory", {
      slug: "alpha-shared",
      body: "for all",
      visibility: "org",
    });
    expect(shared.json<MemoryView>()).toMatchObject({ visibility: "org", ownerKey: "alpha" });
    expect((await tool(betaGateway, "read_memory", { slug: "alpha-shared" })).isError).toBe(false);

    const steal = await call("/v1/memories/alpha-shared", {
      method: "PATCH",
      bearer: beta.key,
      json: { visibility: "private" },
    });
    expect(steal.status).toBe(403);
    expect((await body(steal)).error?.message).toContain("dona");
    const edit = await call("/v1/memories/alpha-shared", {
      method: "PATCH",
      bearer: beta.key,
      json: { body: "edited by beta", visibility: "org" },
    });
    expect(edit.status).toBe(200);

    const publish = await call("/v1/memories/alpha-diary", {
      method: "PATCH",
      bearer: alpha.key,
      json: { visibility: "org" },
    });
    expect((await body<MemoryView>(publish)).data.visibility).toBe("org");
    expect((await tool(betaGateway, "read_memory", { slug: "alpha-diary" })).isError).toBe(false);
    const hide = await tool(alphaGateway, "write_memory", { slug: "alpha-diary", body: "back", visibility: "private" });
    expect(hide.json<MemoryView>().visibility).toBe("private");
    expect((await tool(betaGateway, "read_memory", { slug: "alpha-diary" })).isError).toBe(true);
  });

  test("the panel publishes any memory but cannot make an ownerless one private", async () => {
    const publish = await call("/v1/memories/alpha-pin", {
      method: "PATCH",
      cookie: account.cookie,
      json: { visibility: "org" },
    });
    expect((await body<MemoryView>(publish)).data).toMatchObject({ visibility: "org", ownerKey: "alpha" });
    const hideOrphan = await call("/v1/memories/shared-note", {
      method: "PATCH",
      cookie: account.cookie,
      json: { visibility: "private" },
    });
    expect(hideOrphan.status).toBe(400);
    expect((await body(hideOrphan)).error?.message).toContain("chave dona");
    const createPrivate = await call("/v1/memories", {
      method: "POST",
      cookie: account.cookie,
      json: { slug: "panel-private", name: "x", type: "user", body: "x", visibility: "private" },
    });
    expect(createPrivate.status).toBe(400);
    const importPrivate = await call("/v1/memories/import", {
      method: "POST",
      cookie: account.cookie,
      json: { memories: [{ slug: "panel-private", name: "x", type: "user", body: "x", visibility: "private" }] },
    });
    expect((await body<{ skipped: string[] }>(importPrivate)).data.skipped).toEqual(["panel-private"]);
    expect(
      (
        await call("/v1/memories/alpha-pin", {
          method: "PATCH",
          cookie: account.cookie,
          json: { visibility: "private" },
        })
      ).status,
    ).toBe(200);
  });

  test("a key without a name only writes org memories", async () => {
    const created = await call("/v1/memories", {
      method: "POST",
      bearer: ghost.key,
      json: { slug: "ghost-note", name: "Ghost", type: "user", body: "boo" },
    });
    expect((await body<MemoryView>(created)).data).toMatchObject({ visibility: "org", ownerKey: null });
    const hide = await call("/v1/memories/ghost-note", {
      method: "PATCH",
      bearer: ghost.key,
      json: { visibility: "private" },
    });
    expect(hide.status).toBe(403);
    const privateOne = await call("/v1/memories", {
      method: "POST",
      bearer: ghost.key,
      json: { slug: "ghost-secret", name: "Ghost", type: "user", body: "boo", visibility: "private" },
    });
    expect(privateOne.status).toBe(400);
    expect(await memories(ghost.key)).not.toContain("alpha-diary");
  });
});

describe("storage failures", () => {
  test("a failing private-memory lookup returns STORAGE_FAILED", async () => {
    for (const path of ["/v1/memories", "/v1/context/search?query=wombats", "/v1/context/brief?client=claude"]) {
      const response = await withQueryFaultAsync(HIDDEN_MEMORIES, async () => call(path, { bearer: beta.key }));
      expect(response.status).toBe(500);
    }
    const read = await withQueryFaultAsync(HIDDEN_MEMORIES, () =>
      tool(betaGateway, "read_memory", { slug: "shared-note" }),
    );
    expect(read.text).toContain("STORAGE_FAILED");
    const search = await withQueryFaultAsync(HIDDEN_MEMORIES, () =>
      tool(betaGateway, "search_context", { query: "wombats" }),
    );
    expect(search.isError).toBe(true);
    const gateway = await withQueryFaultAsync(HIDDEN_MEMORIES, () => connectGateway(alpha.key));
    expect(gateway.getInstructions()).not.toContain("alpha-pin");
    await gateway.close();
    const patch = await withQueryFaultAsync(
      (sql) => sql.startsWith("SELECT visibility, owner_key"),
      async () => call("/v1/memories/alpha-diary", { method: "PATCH", bearer: alpha.key, json: { visibility: "org" } }),
    );
    expect(patch.status).toBe(500);
  });
});
