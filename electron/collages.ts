import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Les images collées dans le composeur (Ctrl/Cmd+V) : elles n'ont pas de
 * fichier, on en crée un dans le dossier de l'app (`collages/`), puis il suit le
 * circuit des pièces jointes comme un fichier choisi ou glissé. Seulement le
 * geste de collage : le presse-papiers n'est jamais lu autrement.
 */

/** Les formats que les agents savent lire en image, et leur extension. */
export const FORMATS_COLLAGE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Au-delà, l'image n'est pas jointe (une capture d'écran pèse quelques Mo). */
export const TAILLE_MAX_COLLAGE = 20 * 1024 * 1024;

/** Le contenu est bien celui qu'annonce son type (signature du fichier). */
function signatureValable(octets: Uint8Array, extension: string): boolean {
  const debut = (...valeurs: number[]) => valeurs.every((v, i) => octets[i] === v);
  const texte = (de: number, a: number) => String.fromCharCode(...octets.subarray(de, a));
  switch (extension) {
    case "png":
      return debut(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpg":
      return debut(0xff, 0xd8, 0xff);
    case "gif":
      return texte(0, 6) === "GIF87a" || texte(0, 6) === "GIF89a";
    case "webp":
      return texte(0, 4) === "RIFF" && texte(8, 12) === "WEBP";
    default:
      return false;
  }
}

/** « capture-2026-10-30-114205-1a2b3c4d5e6f.png » : la date du collage, puis l'empreinte du contenu. */
export function nomCollage(date: Date, empreinte: string, extension: string): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  const jour = `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
  const heure = `${deux(date.getHours())}${deux(date.getMinutes())}${deux(date.getSeconds())}`;
  return `capture-${jour}-${heure}-${empreinte}.${extension}`;
}

/* Un collage à la fois : deux collages rapprochés de la même image trouvent le même fichier. */
let enCours: Promise<unknown> = Promise.resolve();

/**
 * Écrit l'image collée et renvoie son chemin. La même image collée deux fois
 * donne le même fichier : la pièce jointe n'est pas doublée.
 */
export function enregistrerCollage(octets: unknown, type: unknown): Promise<string> {
  const suite = enCours.catch(() => {}).then(() => ecrire(octets, type));
  enCours = suite;
  return suite;
}

async function ecrire(octets: unknown, type: unknown): Promise<string> {
  if (!(octets instanceof Uint8Array) || typeof type !== "string") throw new Error("Image collée illisible.");
  const extension = FORMATS_COLLAGE[type];
  if (!extension) throw new Error("Format d’image non pris en charge : PNG, JPEG, GIF ou WebP.");
  if (octets.byteLength > TAILLE_MAX_COLLAGE) throw new Error("Image trop lourde : 20 Mo au plus.");
  if (octets.byteLength === 0 || !signatureValable(octets, extension)) throw new Error("Image collée illisible.");

  const dossier = path.join(app.getPath("userData"), "collages");
  await mkdir(dossier, { recursive: true });
  const empreinte = createHash("sha256").update(octets).digest("hex").slice(0, 12);
  const deja = (await readdir(dossier)).find((f) => f.endsWith(`-${empreinte}.${extension}`));
  if (deja) return path.join(dossier, deja);
  const chemin = path.join(dossier, nomCollage(new Date(), empreinte, extension));
  await writeFile(chemin, octets, { flag: "wx" });
  return chemin;
}
