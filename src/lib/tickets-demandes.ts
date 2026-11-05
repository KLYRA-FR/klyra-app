import { ferme, poserEtape, rouvert } from "@/lib/tickets";
import type { Fil } from "@/types/domain";

/**
 * Ce que l'ordinateur fait d'une demande du téléphone sur un ticket (contrat des lots 3 et 4, règle 4),
 * sans React : le fil qui en résulte, ou le conflit à rendre. Mêmes fonctions que le bureau.
 */

export interface DemandeLue {
  type: "priorite" | "etape" | "fermer" | "supprimer" | "rouvrir" | "confier";
  valeur: Record<string, unknown>;
  /** La révision que le téléphone a vue. */
  revision: number;
}

export type Decision = { fil: Fil } | { conflit: "conflit" | "demande-invalide" };

export function decisionDemande(fil: Fil, demande: DemandeLue, { travaille, aReponse, maintenant }: { travaille: boolean; aReponse: boolean; maintenant: Date }): Decision {
  /* Le fil a déjà changé par une autre demande : fermer, supprimer ou rouvrir n'agissent pas sur un état que la personne n'a pas vu. */
  const change = (fil.revision ?? 0) !== demande.revision;
  switch (demande.type) {
    case "priorite": {
      const priorite = demande.valeur.priorite;
      if (priorite !== 0 && priorite !== 1 && priorite !== 2 && priorite !== 3) return { conflit: "demande-invalide" };
      return { fil: { ...fil, priorite } };
    }
    case "etape":
      if (demande.valeur.etape !== "a-faire" || fil.statut === "archive" || travaille) return { conflit: "conflit" };
      return { fil: poserEtape(fil, "a-faire") };
    case "fermer":
      if (change || travaille || fil.statut === "archive") return { conflit: "conflit" };
      return { fil: ferme(fil, false, maintenant) };
    case "supprimer":
      if (change || travaille) return { conflit: "conflit" };
      return { fil: ferme(fil, true, maintenant) };
    case "rouvrir":
      if (change || fil.statut !== "archive") return { conflit: "conflit" };
      return { fil: rouvert(fil, aReponse) };
    default:
      return { conflit: "demande-invalide" };
  }
}
