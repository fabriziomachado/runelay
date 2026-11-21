import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SkillView } from "@runelay/shared";
import { Link } from "@tanstack/react-router";
import { MonogramTile } from "@/components/ui/display/monogram-tile";
import { Switch } from "@/components/ui/form/switch";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { ResourceAccessPanel } from "@/modules/access/components/resource-access-panel";
import { useSkillToggle } from "@/modules/skills/hooks/use-skill-toggle";
import { SkillBody } from "./skill-body";
import { SkillFiles } from "./skill-files";

interface SkillDetailProps {
  skill: SkillView;
}

export function SkillDetail({ skill }: SkillDetailProps) {
  const t = useT();
  const toggle = useSkillToggle(skill.slug, skill.name);

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/skills"
        className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={1.6} />
        {t("skills.detail.back")}
      </Link>

      <header className="flex items-start gap-3">
        <MonogramTile label={skill.name} className="size-10" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-lg font-semibold">{skill.name}</h1>
          <p className="text-[13px] text-pretty text-muted-foreground">{skill.description || skill.slug}</p>
          <p className="text-[12px] text-muted-foreground/80">
            <span className="font-mono">{skill.slug}</span> ·{" "}
            {t("skills.detail.updatedAt", { date: formatDate(skill.updatedAt) })}
          </p>
        </div>
        <Switch
          checked={skill.enabled}
          disabled={toggle.isPending}
          label={t(skill.enabled ? "skills.detail.disable" : "skills.detail.enable", { name: skill.name })}
          onCheckedChange={(next) => toggle.mutate(next)}
          className="mt-1"
        />
      </header>

      <SkillBody key={skill.updatedAt} skill={skill} />
      <SkillFiles slug={skill.slug} files={skill.files} />
      <ResourceAccessPanel type="skill" id={skill.slug} />
    </div>
  );
}
