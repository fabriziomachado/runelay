import type { Result } from "@runelay/shared";
import { listLiveTools } from "@/modules/connectors/services/connection.service";
import { EXECUTE_LIMITS } from "@/modules/gateway/constants/sandbox.constants";
import { runInSandbox } from "@/modules/gateway/sandbox/run-in-sandbox";
import { callTrackedTool } from "@/modules/gateway/services/tool-call.service";
import type { ExecuteOutput, GatewayCaller, ToolNamespace } from "@/modules/gateway/types/gateway.types";

export const runCode = async (
  caller: GatewayCaller,
  code: string,
  hiddenSources: ReadonlySet<string> = new Set(),
): Promise<Result<ExecuteOutput>> => {
  const tools = await listLiveTools(caller.organizationId);
  if (tools.error) return tools;

  const namespace: ToolNamespace = {};
  for (const tool of tools.data.filter((candidate) => !hiddenSources.has(candidate.source))) {
    namespace[tool.source] = {
      ...namespace[tool.source],
      [tool.name]: (args = {}) => callTrackedTool(caller, tool, args),
    };
  }

  return runInSandbox(code, namespace, EXECUTE_LIMITS);
};
