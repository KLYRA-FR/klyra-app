import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Les pièces jointes envoyées depuis le téléphone (spec mobile T-02) : elles arrivent par le stockage
 * du compte, sont écrites ici, dans le dossier de l'app (`telephone/`), puis suivent le circuit des
 * pièces jointes comme un fichier choisi au bureau. Le compte les efface ensuite.
 */

/** Même plafond qu'une image collée au bureau, et que le téléphone affiche. */
export const TAILLE_MAX_PIECE = 20 * 1024 * 1024;

/** Un nom sans dossier ni caractère interdit sous Windows ou macOS. */
export function nomPropre(nom: string): string {
  const base = nom.split(/[\\/]/).at(-1) ?? "";
  const propre = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, 120);
  return propre || "fichier";
}

/** Écrit la pièce et renvoie son chemin. Le même contenu reçu deux fois garde son nom, dans un dossier à son empreinte. */
export async function recevoirPiece(octets: unknown, nom: unknown): Promise<string> {
  if (!(octets instanceof Uint8Array) || typeof nom !== "string") throw new Error("Pièce jointe illisible.");
  if (octets.byteLength > TAILLE_MAX_PIECE) throw new Error("Pièce jointe trop lourde : 20 Mo au plus.");
  const empreinte = createHash("sha256").update(octets).digest("hex").slice(0, 12);
  const dossier = path.join(app.getPath("userData"), "telephone", empreinte);
  await mkdir(dossier, { recursive: true });
  const chemin = path.join(dossier, nomPropre(nom));
  await writeFile(chemin, octets);
  return chemin;
}
