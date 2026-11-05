import type { AgentFile, AgentsListing, AgentsMeta, KlyraBridge, HistoryEntry, MesAgents, OrigineAgent, Reponse } from "@/lib/bridge";

/** Ce que l'écran demande à une équipe, celle de ce PC ou celle d'un VPS : les mêmes gestes, les mêmes réponses. */
export type PontAgents = Pick<
  KlyraBridge["agents"],
  "list" | "write" | "create" | "installer" | "appliquer" | "mes" | "nommerAssistant" | "activer" | "ajouter" | "changerOrigine" | "definitionRecue" | "history" | "readVersion" | "readMeta" | "writeMeta" | "reveal"
>;

/** L'équipe d'un serveur : celle de ce PC (`lieu` null), ou celle gardée par un VPS (serveur/equipe.mjs). */
export function pontAgents(bridge: KlyraBridge, lieu: string | null): PontAgents {
  if (!lieu) return bridge.agents;
  const appel = <T,>(methode: string, corps: Record<string, unknown> = {}) => bridge.agents.vps!(lieu, methode, corps) as Promise<Reponse<T>>;
  return {
    list: () => appel<AgentsListing>("lister"),
    write: (id: string, contenu: string, attendu: number | null) => appel<AgentFile>("ecrire", { id, contenu, attendu }),
    create: (id: string, contenu: string) => appel<AgentFile>("creer", { id, contenu }),
    installer: (id: string, contenu: string, origine: OrigineAgent, partage: string | null) => appel<{ file: AgentFile; mes: MesAgents }>("installer", { id, contenu, origine, partage }),
    appliquer: (id: string, contenu: string, origine: OrigineAgent, partage: string | null, attendu: number | null, forcer: boolean) =>
      appel<{ file: AgentFile; mes: MesAgents }>("appliquer", { id, contenu, origine, partage, attendu, forcer }),
    mes: () => appel<MesAgents>("mes"),
    nommerAssistant: (nom: string, teinte: string | null) => appel<MesAgents>("assistant", { nom, teinte }),
    activer: (id: string, actif: boolean) => appel<MesAgents>("activer", { id, actif }),
    ajouter: (id: string) => appel<MesAgents>("ajouter", { id }),
    changerOrigine: (id: string, origine: OrigineAgent) => appel<MesAgents>("origine", { id, origine }),
    definitionRecue: (id: string) => appel<string | null>("recue", { id }),
    history: (id: string) => appel<HistoryEntry[]>("historique", { id }),
    readVersion: (id: string, version: string) => appel<string>("version", { id, version }),
    readMeta: () => appel<AgentsMeta>("meta"),
    writeMeta: (meta: AgentsMeta) => appel<void>("meta-ecrire", { meta }),
    reveal: () => Promise.resolve({ ok: false, code: "serveur", message: "Cette fiche est sur le serveur : elle ne s’ouvre pas sur cet ordinateur." }),
  };
}
