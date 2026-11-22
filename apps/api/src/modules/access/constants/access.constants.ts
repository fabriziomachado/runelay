import type { ResourceType } from "@runelay/shared";

export const RESOURCE_LABELS: Record<ResourceType, string> = { source: "conector", skill: "habilidade" };

export const ACCESS_MESSAGES = {
  denied: (type: ResourceType, id: string) =>
    `Esta chave de API não tem acesso ${type === "source" ? "ao" : "à"} ${RESOURCE_LABELS[type]} "${id}". ` +
    `Libere em "Who can use this", na página ${type === "source" ? "do conector" : "da habilidade"} no painel.`,
  memoryDenied: (slug: string) => `A memória "${slug}" é privada de outra chave de API.`,
  memoryVisibility: (slug: string) => `Só a chave dona da memória "${slug}" (ou o painel) muda a visibilidade dela.`,
  memoryOwnerless: (slug: string) =>
    `A memória "${slug}" não tem chave dona: só fica privada se for criada por uma chave de API com nome.`,
  unknownKeys: (names: string[]) => `Chaves de API desconhecidas nesta organização: ${names.join(", ")}.`,
  protectedName: (name: string) =>
    `A chave "${name}" tem acesso restrito a conectores ou habilidades. Gire essa chave pelo painel ou com ela mesma.`,
};
