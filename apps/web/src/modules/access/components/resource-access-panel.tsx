import type { ResourceAccessView, ResourceType, ResourceVisibility } from "@runelay/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/action/button";
import { Skeleton } from "@/components/ui/display/skeleton";
import { useT } from "@/lib/i18n";
import { resourceAccessQuery } from "@/modules/access/api/access.api";
import { useSaveResourceAccess } from "@/modules/access/hooks/use-resource-access";
import { apiKeysQuery } from "@/modules/api-keys/api/api-keys.api";

interface ResourceAccessPanelProps {
  type: ResourceType;
  id: string;
}

export function ResourceAccessPanel({ type, id }: ResourceAccessPanelProps) {
  const t = useT();
  const access = useQuery(resourceAccessQuery(type, id));
  const keys = useQuery(apiKeysQuery);

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4 sm:p-5" aria-labelledby={`access-${type}`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={`access-${type}`} className="text-[13px] font-semibold">
          {t("access.title")}
        </h2>
        <p className="text-[12px] text-pretty text-muted-foreground">{t(`access.description.${type}`)}</p>
      </div>
      {access.data && keys.data ? (
        <AccessForm
          key={`${access.data.visibility}:${access.data.keyNames.join(",")}`}
          view={access.data}
          keyNames={[...new Set(keys.data.flatMap((key) => (key.name ? [key.name] : [])))].sort()}
        />
      ) : (
        <Skeleton className="h-28 w-full" />
      )}
    </section>
  );
}

interface AccessFormProps {
  view: ResourceAccessView;
  keyNames: string[];
}

function AccessForm({ view, keyNames }: AccessFormProps) {
  const t = useT();
  const save = useSaveResourceAccess(view.type, view.id);
  const [visibility, setVisibility] = useState<ResourceVisibility>(view.visibility);
  const [selected, setSelected] = useState<Set<string>>(new Set(view.keyNames));
  const names = [...new Set([...keyNames, ...view.keyNames])].sort();
  const dirty =
    visibility !== view.visibility ||
    (visibility === "restricted" &&
      (selected.size !== view.keyNames.length || view.keyNames.some((name) => !selected.has(name))));
  const group = `access-${view.type}-${view.id}`;

  const toggle = (name: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(name);
    else next.delete(name);
    setSelected(next);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ visibility, keyNames: visibility === "restricted" ? [...selected] : [] });
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">{t("access.title")}</legend>
        {(["org", "restricted"] as const).map((option) => (
          <label
            key={option}
            className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-200 hover:bg-muted/60"
          >
            <input
              type="radio"
              name={group}
              value={option}
              checked={visibility === option}
              onChange={() => setVisibility(option)}
              className="mt-0.5 size-4 accent-foreground"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">
                {t(option === "org" ? "access.everyone" : "access.restricted")}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {t(option === "org" ? "access.everyoneHint" : "access.restrictedHint")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {visibility === "restricted" && (
        <fieldset className="flex flex-col gap-1 rounded-lg border border-border/60 p-2">
          <legend className="px-1 text-[12px] font-medium text-muted-foreground">{t("access.keysLabel")}</legend>
          {names.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">{t("access.noKeys")}</p>
          ) : (
            names.map((name) => (
              <label
                key={name}
                className="flex min-h-9 items-center gap-3 rounded-lg px-2 transition-colors duration-200 hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={(event) => toggle(name, event.target.checked)}
                  className="size-4 accent-foreground"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{name}</span>
              </label>
            ))
          )}
          {names.length > 0 && selected.size === 0 && (
            <p className="px-2 pt-1 text-[12px] text-destructive">{t("access.noneSelected")}</p>
          )}
        </fieldset>
      )}

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-[12px] text-muted-foreground">{t("access.unsaved")}</span>}
        <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending} loadingText={t("access.saving")}>
          {t("access.save")}
        </Button>
      </div>
    </form>
  );
}
