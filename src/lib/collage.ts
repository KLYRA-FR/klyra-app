/**
 * Ce que fait un collage (Ctrl/Cmd+V) dans le composeur, d'après ce que le geste
 * apporte. Le presse-papiers n'est lu qu'à ce geste, jamais autrement.
 * - Du texte : le collage normal, rien d'autre (un tableau copié depuis un
 *   tableur apporte aussi son image ; on veut le texte).
 * - Des fichiers copiés depuis le Finder ou l'Explorateur : leurs chemins, comme un glisser.
 * - Une image sans fichier (capture d'écran) : une seule par geste, même si le
 *   presse-papiers en expose plusieurs représentations ; l'app de bureau l'écrit
 *   dans son dossier (`electron/collages.ts`, mêmes formats et même taille).
 */

/** Les formats que les agents savent lire en image. */
export const FORMATS_IMAGE = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TAILLE_MAX_IMAGE = 20 * 1024 * 1024;

export interface ElementColle {
  type: string;
  taille: number;
  /** Le chemin sur le disque d'un fichier copié ; vide pour une image sans fichier. */
  chemin: string;
}

export type Collage =
  | { action: "texte" }
  | {
      action: "joindre";
      /** Les fichiers copiés, joints tels quels. */
      chemins: string[];
      /** L'image à écrire sur le disque (son rang dans les éléments), s'il y en a une. */
      image: number | null;
      /** Ce qui n'a pas pu être joint, dit sous le composeur. */
      alerte: string | null;
    };

const enMo = (octets: number) => Math.ceil(octets / (1024 * 1024));

/**
 * Une capture collée, écrite par l'app dans son dossier `collages/` : son
 * emplacement ne dit rien à la personne, on montre « Capture collée » à la place.
 */
export function estCaptureCollee(chemin: string): boolean {
  const morceaux = chemin.split(/[\\/]/);
  return morceaux.at(-2) === "collages" && /^capture-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/.test(morceaux.at(-1) ?? "");
}

export function analyserCollage(texte: string, elements: ElementColle[]): Collage {
  if (texte.trim() || elements.length === 0) return { action: "texte" };
  const chemins = [...new Set(elements.map((e) => e.chemin).filter(Boolean))];
  const images = elements.map((e, rang) => ({ ...e, rang })).filter((e) => !e.chemin && e.type.startsWith("image/"));
  if (chemins.length === 0 && images.length === 0) return { action: "texte" };
  if (images.length === 0) return { action: "joindre", chemins, image: null, alerte: null };

  const admise = images.find((e) => FORMATS_IMAGE.includes(e.type));
  if (!admise) return { action: "joindre", chemins, image: null, alerte: "Format d’image non pris en charge : PNG, JPEG, GIF ou WebP." };
  if (admise.taille > TAILLE_MAX_IMAGE) {
    return { action: "joindre", chemins, image: null, alerte: `Image trop lourde (${enMo(admise.taille)} Mo) : 20 Mo au plus.` };
  }
  return { action: "joindre", chemins, image: admise.rang, alerte: null };
}
