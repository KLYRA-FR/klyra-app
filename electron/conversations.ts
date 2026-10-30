import { app } from "electron";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

/**
 * Les conversations (chats et messages) de l'app, gardées dans un fichier
 * JSON du dossier de l'app (`userData/conversations.json`). L'interface en
 * envoie l'état complet ; l'écriture passe par un fichier temporaire, pour
 * qu'un arrêt brutal ne laisse jamais un fichier à moitié écrit.
 */

function fichier(): string {
  return path.join(app.getPath("userData"), "conversations.json");
}

export async function readConversations(): Promise<unknown | null> {
  // Une écriture ratée laisse le fichier précédent intact : on doit encore pouvoir le lire.
  await enCours.catch(() => {});
  try {
    return JSON.parse(await readFile(fichier(), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/* Une écriture à la fois, la dernière demandée gagne. */
let enCours: Promise<void> = Promise.resolve();

export function writeConversations(data: unknown): Promise<void> {
  const contenu = JSON.stringify(data);
  // Une écriture ratée ne doit pas bloquer les suivantes (sinon plus rien n'est enregistré de la session).
  enCours = enCours.catch(() => {}).then(async () => {
    const cible = fichier();
    await mkdir(path.dirname(cible), { recursive: true });
    const temporaire = `${cible}.tmp`;
    const file = await open(temporaire, "w");
    try {
      await file.writeFile(contenu, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaire, cible);
  });
  return enCours;
}

/** Attend la fin des écritures en cours (avant de quitter l'app). */
export function ecrituresTerminees(): Promise<void> {
  return enCours.catch(() => {});
}
