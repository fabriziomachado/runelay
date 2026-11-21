import type { ResourceType, UpdateResourceAccessInput } from "@runelay/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { resourceAccessQuery, updateResourceAccess } from "@/modules/access/api/access.api";

export const useSaveResourceAccess = (type: ResourceType, id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateResourceAccessInput) => updateResourceAccess(type, id, input),
    onSuccess: (view) => {
      queryClient.setQueryData(resourceAccessQuery(type, id).queryKey, view);
      toast(translate("access.saved"));
    },
    onError: (error) => toast(translateError(error), "error"),
  });
};
