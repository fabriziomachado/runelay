import { ok, type Result } from "@runelay/shared";
import { listLiveTools } from "@/modules/connectors/services/connection.service";
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_DETAIL_LIMIT,
  SEARCH_PREVIEW_LENGTH,
} from "@/modules/gateway/constants/gateway.constants";
import type { SearchToolsInput, ToolSummary } from "@/modules/gateway/types/gateway.types";

export const searchTools = async (
  organizationId: string,
  { query, source, limit }: SearchToolsInput,
  hiddenSources: ReadonlySet<string> = new Set(),
): Promise<Result<ToolSummary[]>> => {
  const live = await listLiveTools(organizationId);
  if (live.error) return live;
  const tools = { data: live.data.filter((tool) => !hiddenSources.has(tool.source)) };
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tools.data
    .filter((tool) => !source || tool.source === source)
    .map((tool) => {
      const haystack = `${tool.source}.${tool.name} ${tool.description}`.toLowerCase();
      return { tool, score: terms.filter((term) => haystack.includes(term)).length };
    })
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? (terms.length ? SEARCH_DEFAULT_LIMIT : tools.data.length))
    .map(({ tool }) => tool);

  const detailed = matches.length <= SEARCH_DETAIL_LIMIT;
  return ok(
    matches.map((tool) => ({
      name: `${tool.source}.${tool.name}`,
      description: detailed ? tool.description : tool.description.slice(0, SEARCH_PREVIEW_LENGTH),
      ...(detailed ? { inputSchema: tool.inputSchema } : {}),
    })),
  );
};
