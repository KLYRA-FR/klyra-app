import type { SystemePoste } from "@/lib/poste-texte";
import type { EtatServeur, Sonde } from "@/lib/serveur-vps";

/**
 * Une ligne de serveur sur le téléphone (lot 8, E8-12, E8-46, E8-49) : ce que la sonde a trouvé, en
 * français. Une absence de réponse n'est jamais un arrêt confirmé, et un code d'erreur ou une adresse
 * ne s'affichent jamais. La sonde dit seulement si ce téléphone joint le serveur.
 */

export interface LigneServeur {
  etiquette: string | null;
  ton: "bleue" | "orange" | "neutre";
  phrase: string;
}

const AGENTS: Record<string, string> = {
  pret: "Agents prêts",
  "non-connecte": "Claude Code est à connecter sur le serveur",
  absent: "Claude Code est absent du serveur : relance la commande",
};

const deux = (n: number) => String(n).padStart(2, "0");
const heure = (ms: number) => {
  const d = new Date(ms);
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
};

export function ligneServeur({
  etat,
  sonde,
  agents,
  retard = false,
  verifieLe,
  horsLigne = false,
}: {
  etat: EtatServeur;
  sonde: Sonde | undefined;
  agents?: string;
  /** Il répond, mais son code est plus ancien que celui que cette app attend. */
  retard?: boolean;
  /** L'heure de la dernière vérification, si ce téléphone en a fait une. */
  verifieLe?: number | null;
  /** « ton Mac » : par où passent les messages. */
  sur: string;
  horsLigne?: boolean;
}): LigneServeur {
  if (etat === "quitte") return { etiquette: "Quitté", ton: "neutre", phrase: "Ce téléphone ne l’interroge plus" };
  /* Hors ligne, le téléphone ne sait rien de neuf : pas d'étiquette qui aurait l'air actuelle. */
  if (horsLigne) return { etiquette: null, ton: "neutre", phrase: verifieLe ? `Vérifié à ${heure(verifieLe)}. Possible quand ce téléphone est en ligne` : "Possible quand ce téléphone est en ligne" };
  switch (sonde) {
    case "repond": {
      if (retard) return { etiquette: "À mettre à jour", ton: "orange", phrase: "Il répond, mais son code a du retard : relance la commande sur le VPS." };
      const detail = (agents && AGENTS[agents]) || "Il répond à ce téléphone";
      return { etiquette: "Répond", ton: "bleue", phrase: verifieLe && agents === "pret" ? `${detail} · vérifié à ${heure(verifieLe)}` : detail };
    }
    case "silence":
      return { etiquette: "Ne répond pas", ton: "orange", phrase: "La connexion échoue : les messages directs restent à réessayer vers ce serveur." };
    case "invitation":
      return { etiquette: "Plus relié", ton: "orange", phrase: "Relance la commande sur le VPS et colle le nouveau lien." };
    case "version":
      return { etiquette: "Autre version", ton: "orange", phrase: "Ce serveur ne parle pas la même version." };
    default:
      return { etiquette: "Vérification…", ton: "neutre", phrase: "Ce téléphone l’interroge" };
  }
}

/** Ce qu'on tape pour ouvrir un terminal, selon le poste (jamais « Terminal » en dur, socle § 8). */
export function etapeTerminal(systeme: SystemePoste | null, sur: string): string {
  if (systeme === "mac") return `Sur ${sur}, ouvre Terminal`;
  if (systeme === "windows") return `Sur ${sur}, ouvre PowerShell`;
  return `Sur ${sur}, ouvre un terminal`;
}
