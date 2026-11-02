import path from "node:path";

/**
 * Les binaires de Claude Code des extensions d'éditeur (VS Code et Cursor confondus),
 * le plus récent d'abord : un reste d'éditeur désinstallé ne passe pas devant un plus récent.
 */
export function trierExtensions(binaires: string[]): string[] {
  const dossier = (b: string) => path.basename(path.dirname(path.dirname(path.dirname(b))));
  return [...binaires].sort((a, b) => dossier(b).localeCompare(dossier(a), undefined, { numeric: true }));
}

/**
 * Ce que Claude Code écrit quand il refuse de démarrer, dit pour la personne.
 * Seul cas reconnu : une option de l'app qu'il ne connaît pas, signe d'un Claude Code
 * plus ancien que l'app. Sinon `null` : on garde ce qu'il a écrit.
 */
export function expliquerLancement(sortie: string, binaire: string): string | null {
  const option = /unknown option '([^']+)'/.exec(sortie)?.[1];
  if (!option) return null;
  const editeur = /[\\/]\.(vscode|cursor)[\\/]extensions[\\/]/.exec(binaire)?.[1];
  const lequel = editeur
    ? `celui de l’extension ${editeur === "cursor" ? "Cursor" : "VS Code"}, même si l’éditeur a été désinstallé (${binaire})`
    : binaire;
  return `Claude Code est trop ancien pour KLYRA : il ne connaît pas l’option ${option}. L’app utilise ${lequel}. Mets-le à jour, ou installe Claude Code avec l’installeur officiel : l’app le préférera.`;
}
