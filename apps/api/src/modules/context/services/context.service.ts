import { type ContextBriefView, type ContextClient, ok, type Result } from "@runelay/shared";
import {
  BRIEF_FOOTER,
  BRIEF_MAX_CHARS,
  BRIEF_MEMORY_SHARE,
  BRIEF_MEMORY_TITLE,
  BRIEF_PINNED_TITLE,
  BRIEF_SKILL_TITLE,
  BRIEF_TITLE,
  BRIEF_TRUNCATED,
  MEMORY_TYPE_TITLES,
  PINNED_TRUNCATED,
} from "@/modules/context/constants/context.constants";
import { listPinnedMemories, loadBriefSources } from "@/modules/context/repositories/context.repository";
import type { MemoryIndexRow, PinnedMemoryRow, SkillIndexRow } from "@/modules/context/types/context.types";

export { searchContext } from "@/modules/context/repositories/context.repository";

const firstSentence = (text: string) => (text.split(/(?<=[.!?])\s/)[0] ?? "").trim().slice(0, 200);

const renderPinned = (pinned: PinnedMemoryRow[]) =>
  pinned.length === 0
    ? ""
    : [
        BRIEF_PINNED_TITLE,
        ...pinned.map(
          ({ slug, name, description }) => `- **${name}** (\`${slug}\`)${description ? `: ${description}` : ""}`,
        ),
      ].join("\n");

const fitLines = (title: string, lines: string[], budget: number, truncated = BRIEF_TRUNCATED) => {
  const kept: string[] = [title];
  let used = title.length + 1;
  for (const line of lines) {
    if (used + line.length + 1 + truncated.length > budget) {
      kept.push(truncated);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join("\n");
};

const memoryLines = (memories: MemoryIndexRow[]) =>
  memories.flatMap((memory, index) => {
    const line = `- ${memory.name} (\`${memory.slug}\`)${memory.description ? `: ${memory.description}` : ""}`;
    return memories[index - 1]?.type === memory.type ? [line] : [`### ${MEMORY_TYPE_TITLES[memory.type]}`, line];
  });

const skillLines = (skills: SkillIndexRow[]) =>
  skills.map((skill) => {
    const summary = firstSentence(skill.description);
    return `- ${skill.name} (\`${skill.slug}\`)${summary ? `: ${summary}` : ""}`;
  });

export const pinnedInstructions = (organizationId: string, budget: number): Result<string> => {
  const pinned = listPinnedMemories(organizationId);
  if (pinned.error) return pinned;
  if (pinned.data.length === 0) return ok("");
  const lines = pinned.data.map(({ slug, name }) => `- ${name} (${slug})`);
  return ok(fitLines(BRIEF_PINNED_TITLE, lines, budget, PINNED_TRUNCATED));
};

export const buildBrief = (
  organizationId: string,
  client: ContextClient,
  hiddenSkills: Iterable<string> = [],
): Result<ContextBriefView> => {
  const sources = loadBriefSources(organizationId, hiddenSkills);
  if (sources.error) return sources;
  const { pinned, memories, skills } = sources.data;
  const head = [BRIEF_TITLE, renderPinned(pinned)].filter(Boolean).join("\n\n");
  const budget = Math.max(0, BRIEF_MAX_CHARS - head.length - BRIEF_FOOTER.length - 8);
  const memoryBudget = Math.floor(budget * (skills.length ? BRIEF_MEMORY_SHARE : 1));
  const memorySection = memories.length ? fitLines(BRIEF_MEMORY_TITLE, memoryLines(memories), memoryBudget) : "";
  const skillBudget = budget - memorySection.length;
  const skillSection = skills.length ? fitLines(BRIEF_SKILL_TITLE, skillLines(skills), skillBudget) : "";
  const markdown = [head, memorySection, skillSection, BRIEF_FOOTER].filter(Boolean).join("\n\n");
  return ok({ client, markdown, pinnedCount: pinned.length, skillCount: skills.length });
};
