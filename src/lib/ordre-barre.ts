import { trierParRang } from "./rang-agents";

/** Préférences qui placent un agent dans la barre des chats. */
export interface PrefBarre {
  rang?: number;
  epingleLe?: string;
  masque?: boolean;
}

/**
 * L'ordre de Mes agents dans la barre des chats : l'assistant, les épinglés,
 * les autres, puis les masqués. Dans chaque groupe visible, le rang choisi en
 * glissant ; sans rang, l'ordre reçu (l'ordre de base). Les masqués gardent
 * l'ordre reçu, comme la liste repliée des chats.
 */
export function ordreBarre<T extends { id: string }>(roles: readonly T[], pref: (id: string) => PrefBarre | undefined): T[] {
  const [assistant, ...autres] = roles;
  if (!assistant) return [];
  const rang = (id: string) => pref(id)?.rang;
  const epingleLe = (agent: T) => pref(agent.id)?.epingleLe ?? "";
  const masque = (agent: T) => pref(agent.id)?.masque === true;
  const epingles = trierParRang(
    autres.filter((agent) => epingleLe(agent) && !masque(agent)).sort((a, b) => epingleLe(b).localeCompare(epingleLe(a))),
    rang,
  );
  const suivants = trierParRang(
    autres.filter((agent) => !epingleLe(agent) && !masque(agent)),
    rang,
  );
  const masques = autres.filter(masque);
  return [assistant, ...epingles, ...suivants, ...masques];
}
