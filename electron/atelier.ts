import path from "node:path";

/*
 * Hors projet (message direct, fil sans projet), chaque agent travaille dans son dossier :
 * `<atelier>/<agent>/` (l'assistant dans `<atelier>/principal/`). Ses rendus y restent rangés, à part de
 * ceux des autres. Une conversation commencée avant, dans `<atelier>/` lui-même, y reste : Claude Code
 * retrouve une session par son dossier, et l'agent perdrait sa mémoire en changeant de dossier.
 * Sans Electron ni Node propre au PC : compilé aussi pour le serveur du VPS (`serveur/atelier.mjs`).
 */

/** Le dossier d'un agent dans l'atelier. */
export function atelierDe(atelier: string, agent: string | null): string {
  return path.join(atelier, agent ?? "principal");
}

/** Où Claude Code range les sessions d'un dossier : `<config>/projects/<dossier, chaque signe hors lettres et chiffres en « - »>`. */
export function sessionsDuDossier(configClaude: string, dossier: string): string {
  return path.join(configClaude, "projects", dossier.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * Le dossier de travail hors projet : celui de l'agent, sauf pour une session déjà commencée
 * dans l'atelier commun d'avant, qui y reste.
 */
export function dossierHorsProjet(
  atelier: string,
  agent: string | null,
  sessionId: string | null,
  configClaude: string,
  existe: (chemin: string) => boolean,
): string {
  if (sessionId && existe(path.join(sessionsDuDossier(configClaude, atelier), `${sessionId}.jsonl`))) return atelier;
  return atelierDe(atelier, agent);
}
