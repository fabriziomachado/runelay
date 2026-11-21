import { defineMessages } from "@/lib/i18n/define-messages";

export const accessMessages = defineMessages(
  {
    title: "Quem pode usar",
    description: {
      source:
        "Escolha quais agentes (chaves de API) enxergam e chamam este conector pelo MCP. O painel sempre vê tudo.",
      skill: "Escolha quais agentes (chaves de API) enxergam e leem esta habilidade pelo MCP. O painel sempre vê tudo.",
    },
    everyone: "Todos na organização",
    everyoneHint: "Qualquer chave de API da organização pode usar.",
    restricted: "Só agentes selecionados",
    restrictedHint: "Só as chaves marcadas abaixo podem usar.",
    keysLabel: "Agentes com acesso",
    noKeys: "Nenhuma chave de API ainda. Crie uma em Chaves de API.",
    noneSelected: "Nenhum agente marcado: ninguém vai usar pelo MCP.",
    save: "Salvar",
    saving: "Salvando",
    saved: "Acesso salvo.",
    unsaved: "Alterações não salvas.",
  },
  {
    title: "Who can use this",
    description: {
      source:
        "Choose which agents (API keys) can see and call this connector over MCP. The panel always sees everything.",
      skill: "Choose which agents (API keys) can see and read this skill over MCP. The panel always sees everything.",
    },
    everyone: "Everyone in the organization",
    everyoneHint: "Any API key in the organization can use it.",
    restricted: "Only selected agents",
    restrictedHint: "Only the keys checked below can use it.",
    keysLabel: "Agents with access",
    noKeys: "No API keys yet. Create one in API keys.",
    noneSelected: "No agent checked: nobody will be able to use it over MCP.",
    save: "Save",
    saving: "Saving",
    saved: "Access saved.",
    unsaved: "Unsaved changes.",
  },
);
