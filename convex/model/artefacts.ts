/** Les règles d'un artefact partagé, communes au serveur (`artefactsEquipe.ts`) et à l'app. */

const LIEN = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/;

export const DESCRIPTION_MAX = 500;

/** Le lien comparable (sans « / » final), ou null s'il ne mène pas à un artefact claude.ai. */
export function lienArtefact(url: string): string | null {
  const propre = url.trim().replace(/\/$/, "");
  return LIEN.test(propre) ? propre : null;
}
