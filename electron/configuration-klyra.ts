/**
 * La configuration KLYRA : ce que l'app propose à chacun pour que ses agents consomment moins, à
 * adopter en un clic, modifiable et réversible. Elle ne vaut que pour les sessions lancées par l'app,
 * jamais pour la configuration de Claude Code sur le poste.
 * - Consignes KLYRA : un texte ajouté aux consignes de l'app (Claude Code et Codex), qui économise le
 *   travail sans rien retirer de la qualité. La personne peut le modifier ; le modèle a une version.
 * - Mémoire des agents (`memory` des fiches) : ~4 000 jetons à chaque appel d'un agent qui en a une,
 *   même vide (mesuré le 03/11/2026). Coupée : `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, sans toucher aux fiches.
 * Module pur : lu par le process principal (electron/reglages.ts, claude.ts) et par l'écran.
 */

export interface ConsignesAdoptees {
  texte: string;
  /** La version du modèle KLYRA d'où vient le texte : une plus récente est proposée. */
  version: number;
}

export interface ConfigurationKlyra {
  /** Ajoutées à chaque session de l'app ; null : pas adoptées. */
  consignes: ConsignesAdoptees | null;
  /** Mémoire des agents telle que leurs fiches la demandent ; faux : coupée pour toutes les sessions de l'app. */
  memoireAgents: boolean;
  /** La carte « Configuration recommandée » : à proposer, adoptée, ou écartée par la personne. */
  proposition: "a-proposer" | "adoptee" | "ecartee";
}

export const TAILLE_MAX_CONSIGNES = 6000;

/** Le modèle KLYRA des consignes. Changer le texte : nouvelle version, l'ancienne dans MODELES_PRECEDENTS. */
export const MODELE_CONSIGNES: ConsignesAdoptees = {
  version: 1,
  texte: [
    "- Cherche avant de lire : trouve l'endroit par une recherche (Grep, Glob, rg), puis lis seulement les lignes utiles. N'ouvre pas un gros fichier en entier pour une ligne.",
    "- N'affiche jamais une sortie entière (journal, build, tests) : filtre-la (tail, grep) et garde ce qui sert à décider.",
    "- Pour vérifier, lance la commande de vérification du projet et lis son résultat. Ne relis pas un fichier que tu viens d'écrire : l'outil t'aurait signalé un échec.",
    "- Reste dans le projet : pas d'exploration du poste, ni d'outil installé pour l'occasion sans accord.",
    "- Une question simple appelle une réponse courte. Pas de récapitulatif de chaque étape, pas de reprise de la demande, pas de liste de suites possibles qu'on ne t'a pas demandée.",
    "- Un livrable de plus de quelques lignes va dans un fichier ; dans ta réponse, son chemin et l'essentiel.",
    "- S'il te manque une information pour avancer, demande-la en une ligne plutôt que de la chercher longtemps ou de la deviner.",
  ].join("\n"),
};

/** Les textes des versions précédentes du modèle : un texte resté tel quel passe à la nouvelle d'office. */
export const MODELES_PRECEDENTS: Record<number, string> = {};

export const CONFIGURATION_PAR_DEFAUT: ConfigurationKlyra = { consignes: null, memoireAgents: true, proposition: "a-proposer" };

/** Ce que la carte « Configuration recommandée » adopte en un clic. */
export const CONFIGURATION_RECOMMANDEE: ConfigurationKlyra = { consignes: { ...MODELE_CONSIGNES }, memoireAgents: false, proposition: "adoptee" };

/** Les consignes adoptées, une fois le modèle mis à jour si la personne n'y a pas touché. */
export function consignesAJour(consignes: ConsignesAdoptees | null): ConsignesAdoptees | null {
  if (!consignes || consignes.version >= MODELE_CONSIGNES.version) return consignes;
  return MODELES_PRECEDENTS[consignes.version] === consignes.texte ? { ...MODELE_CONSIGNES } : consignes;
}

/** Une version plus récente du modèle existe, et la personne a modifié le sien : à lui proposer. */
export const nouveauModeleDisponible = (consignes: ConsignesAdoptees | null): boolean => !!consignes && consignes.version < MODELE_CONSIGNES.version;

/** Garde seulement ce qui est valide ; le reste reprend la valeur par défaut. */
export function validerConfiguration(brut: unknown): ConfigurationKlyra {
  const b = (brut ?? {}) as { consignes?: { texte?: unknown; version?: unknown } | null; memoireAgents?: unknown; proposition?: unknown };
  const c = b.consignes;
  const consignes =
    c && typeof c.texte === "string" && typeof c.version === "number" && Number.isInteger(c.version) && c.version > 0
      ? { texte: c.texte.slice(0, TAILLE_MAX_CONSIGNES), version: c.version }
      : null;
  return {
    consignes: consignesAJour(consignes),
    memoireAgents: typeof b.memoireAgents === "boolean" ? b.memoireAgents : CONFIGURATION_PAR_DEFAUT.memoireAgents,
    proposition: b.proposition === "adoptee" || b.proposition === "ecartee" ? b.proposition : "a-proposer",
  };
}

/** Le texte ajouté aux consignes de l'app ; null sans consignes adoptées ou avec un texte vide. */
export function consigneKlyra(consignes: ConsignesAdoptees | null): string | null {
  const texte = consignes?.texte.trim();
  return texte ? `Consignes KLYRA, choisies par la personne pour que ton travail coûte moins :\n${texte}` : null;
}

/** Ce qui change les sessions : une conversation déjà ouverte repart avec, au message suivant. */
export const signatureConfiguration = (c: ConfigurationKlyra): string => JSON.stringify([c.consignes?.texte.trim() ?? null, c.memoireAgents]);

/** La configuration est-elle celle que la carte recommande ? */
export const estRecommandee = (c: ConfigurationKlyra): boolean => !c.memoireAgents && !!c.consignes?.texte.trim();
