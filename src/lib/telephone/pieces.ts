/**
 * Les pièces jointes du téléphone (spec mobile T-02) : « Photo », « Appareil photo », « Fichier », ou
 * une capture collée dans le champ. Elles passent par le stockage du compte, sont écrites sur
 * l'ordinateur avec le message, puis effacées du compte.
 */

/** Comme au bureau (`MAX_FICHIERS` du composeur). */
export const MAX_PIECES = 10;
/** Plafond par fichier : celui d'une image collée au bureau. Le compte et l'ordinateur le vérifient aussi. */
export const TAILLE_MAX_PIECE = 20 * 1024 * 1024;

/** Ce que le téléphone sait d'un fichier choisi (un `File`). */
export interface FichierChoisi {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

const enMo = (octets: number) => Math.max(1, Math.ceil(octets / (1024 * 1024)));

/** « 2,4 Mo », « 830 Ko » : la taille montrée sous une pièce. */
export function taillePiece(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

const meme = (a: FichierChoisi, b: FichierChoisi) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Ajoute les fichiers choisis à ceux déjà joints : sans doublon, 20 Mo au plus chacun, 10 au plus.
 * `alerte` dit ce qui n'a pas été joint, avec le plafond.
 */
export function ajouterPieces<T extends FichierChoisi>(actuelles: T[], nouvelles: T[]): { pieces: T[]; alerte: string | null } {
  const pieces = [...actuelles];
  let alerte: string | null = null;
  for (const fichier of nouvelles) {
    if (pieces.some((p) => meme(p, fichier))) continue;
    if (fichier.size > TAILLE_MAX_PIECE) {
      alerte = `${fichier.name || "Ce fichier"} est trop lourd (${enMo(fichier.size)} Mo) : 20 Mo au plus par fichier.`;
      continue;
    }
    if (fichier.size === 0) {
      alerte = `${fichier.name || "Ce fichier"} est vide.`;
      continue;
    }
    if (pieces.length >= MAX_PIECES) {
      alerte = `${MAX_PIECES} fichiers au plus par message.`;
      break;
    }
    pieces.push(fichier);
  }
  return { pieces, alerte };
}

/** Le nom d'une capture collée, sans nom de fichier : « capture-2026-11-02-114205.png ». */
export function nomCapture(type: string, date: Date): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[type] ?? "png";
  return `capture-${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}-${deux(date.getHours())}${deux(date.getMinutes())}${deux(date.getSeconds())}.${extension}`;
}

/** Le texte d'un message envoyé sans texte, comme au bureau. */
export function texteParDefaut(texte: string, pieces: number): string {
  return texte.trim() || (pieces > 1 ? "Regarde ces fichiers." : "Regarde ce fichier.");
}
