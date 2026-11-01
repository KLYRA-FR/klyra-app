import { app, safeStorage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Le jeton d’appareil de chaque VPS relié, par origine (`https://…`).
 * Comme les jetons du compte (`compte.ts`) : en mémoire en clair, sur le disque chiffrés
 * par le trousseau du système. Sans trousseau, rien n’est écrit : il faudra relier le VPS à nouveau.
 * Le rendu ne les voit jamais.
 */

const fichier = () => path.join(app.getPath("userData"), "serveurs.json");
const ORIGINE = /^https?:\/\/[^\s/]{1,200}$/;

let jetons: Map<string, string> | null = null;
let ecriture: Promise<void> = Promise.resolve();

function charger(): Map<string, string> {
  if (jetons) return jetons;
  jetons = new Map();
  if (!safeStorage.isEncryptionAvailable() || !existsSync(fichier())) return jetons;
  try {
    const brut = JSON.parse(readFileSync(fichier(), "utf8")) as Record<string, unknown>;
    for (const [origine, valeur] of Object.entries(brut)) {
      if (ORIGINE.test(origine) && typeof valeur === "string") jetons.set(origine, safeStorage.decryptString(Buffer.from(valeur, "base64")));
    }
  } catch {
    /* Fichier illisible ou trousseau changé : les VPS seront à relier. */
    jetons.clear();
  }
  return jetons;
}

function enregistrer(): Promise<void> {
  const contenu = charger();
  ecriture = ecriture.then(async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    const chiffre = Object.fromEntries([...contenu].map(([origine, valeur]) => [origine, safeStorage.encryptString(valeur).toString("base64")]));
    const temporaire = `${fichier()}.tmp`;
    await writeFile(temporaire, JSON.stringify(chiffre), { encoding: "utf8", mode: 0o600 });
    await rename(temporaire, fichier());
  });
  return ecriture;
}

export function jetonServeur(origine: string): string | null {
  return charger().get(origine) ?? null;
}

export async function garderJetonServeur(origine: string, jeton: string): Promise<void> {
  if (!ORIGINE.test(origine)) throw new Error("Adresse de serveur invalide.");
  charger().set(origine, jeton);
  await enregistrer();
}

export async function oublierJetonServeur(origine: string): Promise<void> {
  if (charger().delete(origine)) await enregistrer();
}

/** Les VPS reliés à ce PC. */
export function originesServeurs(): string[] {
  return [...charger().keys()];
}
