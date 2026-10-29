/**
 * Computer Use, couche système : les conversions entre une capture d'écran
 * (réduite, telle que le modèle la voit) et l'écran (en points / DIP, l'unité
 * d'Electron). Fonctions pures, sans Electron : testées seules
 * (scripts/test-coordonnees.cjs), sur des cas Retina, Windows à 150 % et
 * plusieurs écrans.
 *
 * Le passage des DIP aux pixels physiques (SendInput sous Windows) se fait à
 * l'exécution par `screen.dipToScreenPoint` ; sur Mac, CGEvent prend des points
 * comme Electron.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Un écran, tel que le donne `screen.getAllDisplays()` d'Electron. */
export interface Ecran {
  id: number;
  /** Position et taille en DIP (points sur Mac), dans le bureau entier. */
  bounds: Rect;
  /** 2 sur un écran Retina, 1,5 sous Windows à 150 %. */
  scaleFactor: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface TailleCapture {
  largeur: number;
  hauteur: number;
}

/**
 * Plus grand côté d'une capture. Anthropic conseille de ne pas dépasser
 * 1920×1080 pour Computer Use ; Claude Code réduit un écran Retina de 16 pouces
 * à environ 1372×887. 1568 garde le texte lisible sans alourdir chaque tour.
 */
export const COTE_MAX = 1568;

/** La taille de la capture d'un écran : sa taille en DIP, réduite si elle dépasse `max` (jamais agrandie). */
export function tailleCapture(ecran: Ecran, max = COTE_MAX): TailleCapture {
  const { width, height } = ecran.bounds;
  const facteur = Math.min(1, max / Math.max(width, height));
  return { largeur: Math.max(1, Math.round(width * facteur)), hauteur: Math.max(1, Math.round(height * facteur)) };
}

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Un point de la capture (coordonnées que donne le modèle) → un point de
 * l'écran, en DIP du bureau entier. Hors de la capture : ramené au bord.
 */
export function versEcran(ecran: Ecran, capture: TailleCapture, point: Point): Point {
  const x = borner(point.x, 0, capture.largeur - 1);
  const y = borner(point.y, 0, capture.hauteur - 1);
  // Le centre du pixel de capture, pour ne pas glisser vers le haut à gauche en réduisant.
  return {
    x: Math.round(ecran.bounds.x + ((x + 0.5) * ecran.bounds.width) / capture.largeur - 0.5),
    y: Math.round(ecran.bounds.y + ((y + 0.5) * ecran.bounds.height) / capture.hauteur - 0.5),
  };
}

/** L'inverse : un point de l'écran (DIP) → la capture. */
export function versCapture(ecran: Ecran, capture: TailleCapture, point: Point): Point {
  return {
    x: Math.round(((point.x - ecran.bounds.x + 0.5) * capture.largeur) / ecran.bounds.width - 0.5),
    y: Math.round(((point.y - ecran.bounds.y + 0.5) * capture.hauteur) / ecran.bounds.height - 0.5),
  };
}

/** L'écran qui contient un point (DIP), sinon le plus proche. */
export function ecranDuPoint(ecrans: Ecran[], point: Point): Ecran {
  const dedans = ecrans.find((e) => point.x >= e.bounds.x && point.x < e.bounds.x + e.bounds.width && point.y >= e.bounds.y && point.y < e.bounds.y + e.bounds.height);
  if (dedans) return dedans;
  const distance = (e: Ecran) => {
    const dx = Math.max(e.bounds.x - point.x, 0, point.x - (e.bounds.x + e.bounds.width));
    const dy = Math.max(e.bounds.y - point.y, 0, point.y - (e.bounds.y + e.bounds.height));
    return dx * dx + dy * dy;
  };
  return [...ecrans].sort((a, b) => distance(a) - distance(b))[0];
}
