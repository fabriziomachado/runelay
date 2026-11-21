import { layoutMessages } from "@/components/layout/i18n";
import { accessMessages } from "@/modules/access/i18n";
import { activityMessages } from "@/modules/activity/i18n";
import { apiKeysMessages } from "@/modules/api-keys/i18n";
import { authMessages } from "@/modules/auth/i18n";
import { catalogMessages } from "@/modules/catalog/i18n";
import { cliMessages } from "@/modules/cli/i18n";
import { memoryMessages } from "@/modules/memory/i18n";
import { onboardingMessages } from "@/modules/onboarding/i18n";
import { organizationsMessages } from "@/modules/organizations/i18n";
import { overviewMessages } from "@/modules/overview/i18n";
import { reconnectMessages } from "@/modules/reconnect/i18n";
import { searchMessages } from "@/modules/search/i18n";
import { settingsMessages } from "@/modules/settings/i18n";
import { setupMessages } from "@/modules/setup/i18n";
import { skillsMessages } from "@/modules/skills/i18n";
import { sourcesMessages } from "@/modules/sources/i18n";
import { systemMessages } from "@/modules/system/i18n";
import type { Locale } from "./locale";
import { commonMessages } from "./messages/common";
import { errorMessages } from "./messages/errors";

const MODULES = {
  common: commonMessages,
  errors: errorMessages,
  layout: layoutMessages,
  access: accessMessages,
  activity: activityMessages,
  apiKeys: apiKeysMessages,
  auth: authMessages,
  catalog: catalogMessages,
  cli: cliMessages,
  memory: memoryMessages,
  onboarding: onboardingMessages,
  organizations: organizationsMessages,
  overview: overviewMessages,
  reconnect: reconnectMessages,
  search: searchMessages,
  settings: settingsMessages,
  setup: setupMessages,
  skills: skillsMessages,
  sources: sourcesMessages,
  system: systemMessages,
};

type Modules = typeof MODULES;

export type Dictionary = { [K in keyof Modules]: Modules[K]["pt-BR"] };

const pick = (locale: Locale) =>
  Object.fromEntries(Object.entries(MODULES).map(([name, messages]) => [name, messages[locale]])) as Dictionary;

export const DICTIONARIES: Record<Locale, Dictionary> = { "pt-BR": pick("pt-BR"), en: pick("en") };
