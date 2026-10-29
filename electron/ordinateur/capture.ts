import { desktopCapturer, screen } from "electron";
import { ecranDuPoint, tailleCapture, type Ecran, type TailleCapture } from "./coordonnees";
import { verifierInterrupteur } from "./garde";

/**
 * Computer Use, couche système : la capture d'un écran, réduite à la taille
 * que voit le modèle (coordonnees.ts), en JPEG. Sur Mac, il faut l'autorisation
 * Enregistrement de l'écran ; sans elle, macOS rend une image vide ou le seul
 * fond d'écran. Jamais sans l'interrupteur des Réglages.
 */

export interface Capture extends TailleCapture {
  jpeg: Buffer;
  ecran: Ecran;
}

export function ecrans(): Ecran[] {
  return screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }));
}

/** L'écran voulu, sinon celui où est la souris. */
function choisirEcran(id?: number): Ecran {
  const liste = ecrans();
  return liste.find((e) => e.id === id) ?? ecranDuPoint(liste, screen.getCursorScreenPoint());
}

export async function capturer(ecranId?: number): Promise<Capture> {
  verifierInterrupteur();
  const ecran = choisirEcran(ecranId);
  const taille = tailleCapture(ecran);
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: taille.largeur, height: taille.hauteur } });
  const source = sources.find((s) => s.display_id === String(ecran.id)) ?? (sources.length === 1 ? sources[0] : undefined);
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("Capture impossible : accorde l’autorisation Enregistrement de l’écran à KLYRA (Réglages → Computer Use).");
  }
  // La miniature garde les proportions de l'écran : on la met à la taille exacte attendue par les conversions.
  const image = source.thumbnail.resize({ width: taille.largeur, height: taille.hauteur, quality: "good" });
  return { ...taille, jpeg: image.toJPEG(80), ecran };
}
