import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  contextSearchSchema,
  MEMORY_IMPORT_TOOL_LIMIT,
  memorySlugSchema,
  memoryVisibilitySchema,
  memoryWriteSchema,
  ok,
  skillFileSchema,
  skillSlugSchema,
  skillWriteSchema,
} from "@runelay/shared";
import { z } from "zod";
import { env } from "@/config/env";
import { ensureAccess, hiddenResourcesFor, memoryScopeFor } from "@/modules/access/services/access.service";
import type { MemoryScope } from "@/modules/access/types/access.types";
import { RESERVED_SOURCES } from "@/modules/activity/constants/activity.constants";
import { recordToolCall } from "@/modules/activity/repositories/activity.repository";
import { findTool } from "@/modules/connectors/services/connection.service";
import { pinnedInstructions, searchContext } from "@/modules/context/services/context.service";
import {
  GATEWAY_INFO,
  GATEWAY_INSTRUCTIONS,
  GATEWAY_INSTRUCTIONS_MAX_CHARS,
  TOOL_DESCRIPTIONS,
} from "@/modules/gateway/constants/gateway.constants";
import { toToolResponse } from "@/modules/gateway/mcp/tool-response";
import { runCode } from "@/modules/gateway/services/execute.service";
import { searchTools } from "@/modules/gateway/services/search.service";
import { callTrackedTool } from "@/modules/gateway/services/tool-call.service";
import type { GatewayCaller } from "@/modules/gateway/types/gateway.types";
import { findMemory, importMemoryItems, writeMemory } from "@/modules/memories/services/memory.service";
import { findSkill, findSkillFile, writeSkill, writeSkillFile } from "@/modules/skills/services/skill.service";
import { listSourceViews } from "@/modules/sources/services/source.service";
import { redactView } from "@/modules/sources/utils/redact-config";

export const createGatewayServer = (caller: GatewayCaller) => {
  const { organizationId } = caller;
  const initialScope = memoryScopeFor(caller);
  const pinned = initialScope.error
    ? initialScope
    : pinnedInstructions(
        organizationId,
        GATEWAY_INSTRUCTIONS_MAX_CHARS - GATEWAY_INSTRUCTIONS.length - 2,
        initialScope.data.hidden,
      );
  const instructions = [GATEWAY_INSTRUCTIONS, pinned.data ?? ""].filter(Boolean).join("\n\n");
  const server = new McpServer(GATEWAY_INFO, { instructions });
  const track = async (source: string, tool: string, run: () => CallToolResult | Promise<CallToolResult>) => {
    const startedAt = performance.now();
    const response = await run();
    recordToolCall({
      organizationId,
      apiKeyId: caller.apiKeyId,
      source,
      tool,
      ok: !response.isError,
      durationMs: performance.now() - startedAt,
    });
    return response;
  };
  const withScope = (run: (scope: MemoryScope) => CallToolResult) => {
    const scope = memoryScopeFor(caller);
    return scope.error ? toToolResponse(scope) : run(scope.data);
  };
  const allowed = (type: "source" | "skill", id: string, run: () => CallToolResult | Promise<CallToolResult>) => {
    const access = ensureAccess(caller, type, id);
    return access.error ? toToolResponse(access) : run();
  };

  server.registerTool("list_connections", { description: TOOL_DESCRIPTIONS.listConnections, inputSchema: {} }, () =>
    track(RESERVED_SOURCES.runelay, "list_connections", () => {
      const hidden = hiddenResourcesFor(caller);
      if (hidden.error) return toToolResponse(hidden);
      const views = listSourceViews(organizationId);
      if (views.error) return toToolResponse(views);
      return toToolResponse(ok(views.data.filter((view) => !hidden.data.source.has(view.name)).map(redactView)));
    }),
  );

  server.registerTool(
    "search_tools",
    {
      description: TOOL_DESCRIPTIONS.searchTools,
      inputSchema: {
        query: z.string().optional(),
        source: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    (input) =>
      track(RESERVED_SOURCES.runelay, "search_tools", async () => {
        const hidden = hiddenResourcesFor(caller);
        if (hidden.error) return toToolResponse(hidden);
        return toToolResponse(await searchTools(organizationId, input, hidden.data.source));
      }),
  );

  server.registerTool(
    "call_tool",
    {
      description: TOOL_DESCRIPTIONS.callTool,
      inputSchema: { name: z.string(), args: z.record(z.string(), z.unknown()).optional() },
    },
    async ({ name, args }) => {
      const [source = name] = name.split(".", 1);
      const access = ensureAccess(caller, "source", source);
      if (access.error) return toToolResponse(access);
      const tool = await findTool(organizationId, name);
      if (tool.error) return toToolResponse(tool);
      return toToolResponse(await callTrackedTool(caller, tool.data, args ?? {}));
    },
  );

  if (env.RUNELAY_ENABLE_EXECUTE) {
    server.registerTool(
      "execute",
      { description: TOOL_DESCRIPTIONS.execute, inputSchema: { code: z.string() } },
      async ({ code }) => {
        const hidden = hiddenResourcesFor(caller);
        return toToolResponse(hidden.error ? hidden : await runCode(caller, code, hidden.data.source));
      },
    );
  }

  server.registerTool(
    "search_context",
    { description: TOOL_DESCRIPTIONS.searchContext, inputSchema: contextSearchSchema.shape },
    (input) =>
      track(RESERVED_SOURCES.runelay, "search_context", () => {
        const hidden = hiddenResourcesFor(caller);
        if (hidden.error) return toToolResponse(hidden);
        return withScope((scope) =>
          toToolResponse(searchContext(organizationId, input, hidden.data.skill, scope.hidden)),
        );
      }),
  );

  server.registerTool(
    "read_memory",
    { description: TOOL_DESCRIPTIONS.readMemory, inputSchema: { slug: memorySlugSchema } },
    ({ slug }) =>
      track(RESERVED_SOURCES.memories, slug, () =>
        withScope((scope) => toToolResponse(findMemory(organizationId, slug, scope))),
      ),
  );

  server.registerTool(
    "write_memory",
    {
      description: TOOL_DESCRIPTIONS.writeMemory,
      inputSchema: memoryWriteSchema.shape,
    },
    (input) =>
      track(RESERVED_SOURCES.memories, input.slug, () =>
        withScope((scope) => toToolResponse(writeMemory(organizationId, input, undefined, scope))),
      ),
  );

  server.registerTool(
    "import_memory",
    {
      description: TOOL_DESCRIPTIONS.importMemory,
      inputSchema: {
        items: z
          .array(
            z.object({
              slug: z.string(),
              body: z.string(),
              name: z.string().optional(),
              description: z.string().optional(),
              type: z.string().optional(),
              visibility: memoryVisibilitySchema.optional(),
              createdAt: z.string().optional(),
            }),
          )
          .min(1)
          .max(MEMORY_IMPORT_TOOL_LIMIT),
      },
    },
    ({ items }) =>
      track(RESERVED_SOURCES.memories, "import_memory", () =>
        withScope((scope) => toToolResponse(ok(importMemoryItems(organizationId, items, scope)))),
      ),
  );

  server.registerTool(
    "read_skill",
    { description: TOOL_DESCRIPTIONS.readSkill, inputSchema: { slug: skillSlugSchema } },
    ({ slug }) =>
      track(RESERVED_SOURCES.skills, slug, () =>
        allowed("skill", slug, () => toToolResponse(findSkill(organizationId, slug))),
      ),
  );

  server.registerTool(
    "read_skill_file",
    { description: TOOL_DESCRIPTIONS.readSkillFile, inputSchema: { slug: skillSlugSchema, path: z.string().min(1) } },
    ({ slug, path }) =>
      track(RESERVED_SOURCES.skills, slug, () =>
        allowed("skill", slug, () => toToolResponse(findSkillFile(organizationId, slug, path))),
      ),
  );

  server.registerTool(
    "write_skill",
    { description: TOOL_DESCRIPTIONS.writeSkill, inputSchema: skillWriteSchema.shape },
    (input) =>
      track(RESERVED_SOURCES.skills, input.slug, () =>
        allowed("skill", input.slug, () => toToolResponse(writeSkill(organizationId, input))),
      ),
  );

  server.registerTool(
    "write_skill_file",
    {
      description: TOOL_DESCRIPTIONS.writeSkillFile,
      inputSchema: { slug: skillSlugSchema, ...skillFileSchema.shape },
    },
    ({ slug, ...file }) =>
      track(RESERVED_SOURCES.skills, slug, () =>
        allowed("skill", slug, () => toToolResponse(writeSkillFile(organizationId, slug, file))),
      ),
  );

  return server;
};
