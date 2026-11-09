import type { AgentEvent, Decision, DetailsDecision, IdMoteur, Moteur, Spontane, StreamOptions } from "./types";

/**
 * Les moteurs de l'app, et celui qui fait chaque réponse. Une réponse en cours n'est qu'à
 * un moteur : arrêter et autoriser passent par chacun, seul celui qui la porte agit.
 */
export function creerRegistre(liste: Moteur[], parDefaut: IdMoteur) {
  const parId = new Map<string, Moteur>(liste.map((m) => [m.id, m]));
  /** Le moteur demandé ; sans demande, celui par défaut ; null s'il est inconnu. */
  const moteur = (id?: string | null): Moteur | null => parId.get(id || parDefaut) ?? null;

  return {
    liste: () => [...liste],
    moteur,
    /** Fait répondre l'agent avec `options.moteur`. Se termine toujours par un événement `fin`. */
    lancer(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void, spontane: Spontane): void {
      const choisi = moteur(options.moteur);
      if (!choisi) return emit({ type: "fin", ok: false, texte: "", erreur: `Fournisseur inconnu : ${options.moteur}.` });
      choisi.lancer(requestId, options, emit, spontane);
    },
    arreter(requestId: string): void {
      for (const m of liste) m.arreter(requestId);
    },
    autoriser(requestId: string, demandeId: string, decision: Decision, details?: DetailsDecision): boolean {
      return liste.some((m) => m.autoriser(requestId, demandeId, decision, details));
    },
    fermer(): void {
      for (const m of liste) m.fermer?.();
    },
  };
}
