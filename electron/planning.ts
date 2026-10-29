import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Le planning de l'app (calendrier, rappels, routines) en clair, pour les agents :
 * chaque Claude Code lancé par l'app peut lire ce dossier (--add-dir), et sait
 * qu'il y trouve l'agenda de la personne. Il reste sur l'ordinateur.
 */
export const DOSSIER_PLANNING = path.join(os.homedir(), ".klyra", "planning");
export const FICHIER_PLANNING = path.join(DOSSIER_PLANNING, "planning.md");

export async function ecrirePlanning(markdown: string): Promise<void> {
  await mkdir(DOSSIER_PLANNING, { recursive: true });
  const temporaire = `${FICHIER_PLANNING}.tmp`;
  await writeFile(temporaire, markdown, "utf8");
  await rename(temporaire, FICHIER_PLANNING);
}
