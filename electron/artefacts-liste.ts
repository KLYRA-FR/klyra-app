/**
 * La réponse de Claude Code (`claude -p --output-format json`) à « liste mes artefacts », lue sans
 * Electron pour être testée (`artefacts-liste.test.mts`). Un échec dit pourquoi, pour la personne :
 * jamais un message vague qui cache la réponse de Claude Code.
 */

export const LIEN_ARTEFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;

export interface ArtefactClaude {
  titre: string;
  url: string;
  misAJour: string | null;
}

/** Ce que Claude Code a répondu, coupé pour tenir dans une ligne de l'écran. */
const extrait = (texte: string) => {
  const ligne = texte.replace(/\s+/g, " ").trim();
  return ligne.length > 220 ? `${ligne.slice(0, 220)}…` : ligne;
};

/** Le tableau d'artefacts, ou une erreur dont le message dit pourquoi il manque. */
export function lireListeArtefacts(sortie: string): ArtefactClaude[] {
  let json: { result?: unknown; is_error?: unknown; permission_denials?: unknown };
  try {
    json = JSON.parse(sortie);
  } catch {
    throw new Error(sortie.trim() ? `Claude Code a répondu autre chose que prévu : « ${extrait(sortie)} »` : "Claude Code n’a rien répondu.");
  }
  const resultat = typeof json.result === "string" ? json.result : "";
  if (json.is_error) {
    if (/not logged in|\/login|invalid api key|authentication/i.test(resultat)) {
      throw new Error("Claude Code n’est pas connecté à ton compte Claude sur ce poste : ouvre un terminal, lance claude puis /login, et réessaie.");
    }
    throw new Error(resultat ? `Claude Code a échoué : « ${extrait(resultat)} »` : "Claude Code a échoué sans dire pourquoi.");
  }
  if (Array.isArray(json.permission_denials) && json.permission_denials.length) {
    throw new Error("Claude Code n’a pas pu utiliser l’outil Artifact sur ce poste.");
  }
  const debut = resultat.indexOf("[");
  const fin = resultat.lastIndexOf("]");
  let liste: unknown;
  try {
    liste = debut >= 0 && fin > debut ? JSON.parse(resultat.slice(debut, fin + 1)) : undefined;
  } catch {
    liste = undefined;
  }
  if (!Array.isArray(liste)) {
    // Le plus souvent : l'outil Artifact n'existe pas pour ce compte (connexion par clé d'API, plan sans artefacts).
    throw new Error(resultat ? `Claude Code n’a pas pu lire tes artefacts : « ${extrait(resultat)} »` : "Claude Code n’a pas renvoyé de liste.");
  }
  return (liste as { titre?: unknown; url?: unknown; misAJour?: unknown }[])
    .filter((a) => a && typeof a.url === "string" && LIEN_ARTEFACT.test(a.url))
    .map((a) => ({
      titre: typeof a.titre === "string" && a.titre ? a.titre : "Sans titre",
      url: a.url as string,
      misAJour: typeof a.misAJour === "string" ? a.misAJour : null,
    }));
}
