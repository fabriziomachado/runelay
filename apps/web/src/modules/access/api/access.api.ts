import type { ResourceAccessView, ResourceType, UpdateResourceAccessInput } from "@runelay/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

const PATHS: Record<ResourceType, string> = { source: "sources", skill: "skills" };

const accessPath = (type: ResourceType, id: string) => `/access/${PATHS[type]}/${encodeURIComponent(id)}`;

export const resourceAccessQuery = (type: ResourceType, id: string) =>
  queryOptions({
    queryKey: ["access", type, id],
    queryFn: () => api.get<ResourceAccessView>(accessPath(type, id)),
  });

export const updateResourceAccess = (type: ResourceType, id: string, input: UpdateResourceAccessInput) =>
  api.put<ResourceAccessView>(accessPath(type, id), input);
