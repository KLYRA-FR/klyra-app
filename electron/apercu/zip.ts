import { inflateRawSync } from "node:zlib";

/**
 * Lecture d'une archive zip (xlsx, docx) sur l'ordinateur, sans dépendance :
 * le répertoire central, puis chaque fichier décompressé à la demande.
 * Ni zip64 ni chiffrement : ces fichiers n'ont pas d'aperçu.
 */

/** Au-delà, un fichier de l'archive est trop gros pour un aperçu (bombe zip comprise). */
const DECOMPRESSE_MAX = 48 * 1024 * 1024;

/** Une raison montrée telle quelle dans la visionneuse, à la place de l'aperçu. */
export class ErreurApercu extends Error {}

export const ILLISIBLE = "Fichier illisible pour l’aperçu.";
export const PROTEGE = "Fichier protégé par un mot de passe : pas d’aperçu.";

interface Entree {
  methode: number;
  compresse: number;
  taille: number;
  local: number;
}

export interface Archive {
  /** Le contenu d'un fichier de l'archive (nom insensible à la casse), ou null s'il n'y est pas. */
  lire(nom: string): Buffer | null;
  lireTexte(nom: string): string | null;
}

export function ouvrirZip(octets: Buffer): Archive {
  // Fin du répertoire central : dans les 64 Ko de la fin (commentaire compris).
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 22 - 0xffff); i--) {
    if (octets.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErreurApercu(ILLISIBLE);
  const nombre = octets.readUInt16LE(fin + 10);
  let pos = octets.readUInt32LE(fin + 16);
  if (nombre === 0xffff || pos === 0xffffffff) throw new ErreurApercu("Archive trop grande pour l’aperçu.");

  const entrees = new Map<string, Entree>();
  for (let n = 0; n < nombre; n++) {
    if (pos + 46 > octets.length || octets.readUInt32LE(pos) !== 0x02014b50) throw new ErreurApercu(ILLISIBLE);
    const drapeaux = octets.readUInt16LE(pos + 8);
    const longueurNom = octets.readUInt16LE(pos + 28);
    const nom = octets.toString(drapeaux & 0x800 ? "utf8" : "latin1", pos + 46, pos + 46 + longueurNom);
    if (drapeaux & 1) throw new ErreurApercu(PROTEGE);
    entrees.set(nom.replace(/^\//, "").toLowerCase(), {
      methode: octets.readUInt16LE(pos + 10),
      compresse: octets.readUInt32LE(pos + 20),
      taille: octets.readUInt32LE(pos + 24),
      local: octets.readUInt32LE(pos + 42),
    });
    pos += 46 + longueurNom + octets.readUInt16LE(pos + 30) + octets.readUInt16LE(pos + 32);
  }

  const lire = (nom: string): Buffer | null => {
    const e = entrees.get(nom.replace(/^\//, "").toLowerCase());
    if (!e) return null;
    if (e.local + 30 > octets.length || octets.readUInt32LE(e.local) !== 0x04034b50) throw new ErreurApercu(ILLISIBLE);
    const debut = e.local + 30 + octets.readUInt16LE(e.local + 26) + octets.readUInt16LE(e.local + 28);
    const donnees = octets.subarray(debut, debut + e.compresse);
    if (e.taille > DECOMPRESSE_MAX) throw new ErreurApercu("Fichier trop lourd pour l’aperçu.");
    if (e.methode === 0) return donnees;
    if (e.methode !== 8) throw new ErreurApercu(ILLISIBLE);
    try {
      return inflateRawSync(donnees, { maxOutputLength: DECOMPRESSE_MAX });
    } catch {
      throw new ErreurApercu("Fichier trop lourd ou abîmé pour l’aperçu.");
    }
  };

  return {
    lire,
    lireTexte: (nom) => lire(nom)?.toString("utf8").replace(/^﻿/, "") ?? null,
  };
}

/** Le chemin d'une cible de relation (`.rels`), depuis le dossier de la partie qui la cite. */
export function cibleRelation(dossier: string, cible: string): string {
  const morceaux = cible.startsWith("/") ? [] : dossier.split("/").filter(Boolean);
  for (const m of cible.split("/")) {
    if (!m || m === ".") continue;
    if (m === "..") morceaux.pop();
    else morceaux.push(m);
  }
  return morceaux.join("/");
}
