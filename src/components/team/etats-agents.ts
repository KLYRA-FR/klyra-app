import type { AgentLocal } from "@/lib/agents";
import type { Lien } from "@/lib/lien-bibliotheque";
import type { Etiquette } from "./AgentCard";

/**
 * Les étiquettes d'une carte de Mes agents (spec §4, §7) : « À configurer » d'abord, puis « Mise à
 * jour », puis l'origine ; deux au plus. Un lien suspendu ne met rien sur la carte (une seule ligne
 * en tête de Mes agents le dit pour tous).
 */
export function etiquettesDe(agent: AgentLocal, lien: Lien): Etiquette[] {
  const etiquettes: Etiquette[] = [];
  if (agent.manquantes.length) etiquettes.push({ texte: "À configurer", ton: "a-configurer" });
  if (lien.type === "recu" && lien.proposition) etiquettes.push({ texte: "Mise à jour", ton: "accent" });
  const origine =
    lien.type === "modele"
      ? lien.aJour
        ? "Modèle KLYRA"
        : null
      : lien.type === "recu"
        ? lien.retiree
          ? "Copie privée"
          : `De ${lien.auteur}`
        : lien.type === "publie"
          ? "Partagé"
          : lien.type === "copie"
            ? "Copie privée"
            : null;
  if (origine) etiquettes.push({ texte: origine, ton: "neutre" });
  return etiquettes.slice(0, 2);
}

const jourCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** « 30 oct. » */
export function dateCourte(ms: number): string {
  return jourCourt.format(ms);
}
