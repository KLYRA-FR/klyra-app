import type { EtatConsignesProjet } from "../../electron/consignes-projet";

/**
 * Ce que la carte des consignes d'un projet dit de ses fichiers (ConsignesProjet). Un projet qui a déjà
 * un CLAUDE.md ou un AGENTS.md a des consignes : on ne dit « pas encore » que s'il n'a ni l'un ni l'autre.
 */
export interface SituationConsignes {
  /** `vierge` : aucun des deux ; `en-place` : AGENTS.md importé par CLAUDE.md ; les autres : des consignes à compléter. */
  cas: "vierge" | "en-place" | "claude-seul" | "agents-seul" | "sans-lien";
  texte: string;
  /** Le fichier que « Ouvrir » montre (absent pour un projet vierge). */
  fichier: "AGENTS.md" | "CLAUDE.md" | null;
  /** Le bouton qui montre ce que l'app écrirait (absent quand il n'y a rien à écrire). */
  completer: string | null;
}

export function situationConsignes(etat: Pick<EtatConsignesProjet, "agentsMd" | "claudeMd" | "propositions">): SituationConsignes {
  const aCompleter = etat.propositions.length > 0;
  if (!etat.agentsMd && etat.claudeMd === "absent") {
    return {
      cas: "vierge",
      texte: "Pas encore de consignes pour les agents de ce projet. Un AGENTS.md court leur évite de redécouvrir le projet à chaque fois.",
      fichier: null,
      completer: "Ajouter les consignes KLYRA",
    };
  }
  if (!etat.agentsMd) {
    return {
      cas: "claude-seul",
      texte: "Consignes du projet : CLAUDE.md, lu par Claude. Un AGENTS.md les donnerait aussi à ChatGPT et à Grok.",
      fichier: "CLAUDE.md",
      completer: aCompleter ? "Ajouter AGENTS.md" : null,
    };
  }
  if (etat.claudeMd === "absent") {
    return {
      cas: "agents-seul",
      texte: "Consignes du projet : AGENTS.md. Un CLAUDE.md d’une ligne le fait lire par toutes les versions de Claude.",
      fichier: "AGENTS.md",
      completer: aCompleter ? "Ajouter CLAUDE.md" : null,
    };
  }
  if (etat.claudeMd === "sans-import") {
    return {
      cas: "sans-lien",
      texte: "Consignes du projet : CLAUDE.md et AGENTS.md. Le CLAUDE.md ne renvoie pas vers AGENTS.md : toutes les versions de Claude ne le liront pas.",
      fichier: "AGENTS.md",
      completer: aCompleter ? "Relier AGENTS.md" : null,
    };
  }
  return { cas: "en-place", texte: "Consignes du projet : AGENTS.md, lu par tes agents à chaque session.", fichier: "AGENTS.md", completer: null };
}
