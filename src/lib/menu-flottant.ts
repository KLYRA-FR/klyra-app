/** Marge au bord de la fenêtre, la même que `max-w-[calc(100vw-32px)]`. */
export const MARGE_MENU = 16;
/** Largeur du menu fournisseur, modèle et effort. */
export const LARGEUR_MENU = 400;
/** Écart entre le bouton et le menu (`mt-2`). */
export const ECART_MENU = 8;

export interface CadreBouton {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlaceMenu {
  left: number;
  top?: number;
  bottom?: number;
  largeur: number;
  versLeHaut: boolean;
}

/**
 * Place le menu du tiroir dans la fenêtre, entier. Le panneau le rognait :
 * il est plus étroit que le menu, et son défilement coupe ce qui dépasse.
 * On aligne le menu sur le bouton, on le décale s'il sortirait de la fenêtre,
 * et on l'ouvre vers le haut quand la place manque en dessous.
 */
export function placeMenuFlottant(
  bouton: CadreBouton,
  fenetre: { width: number; height: number },
  hauteur: number,
  largeurVoulue = LARGEUR_MENU,
): PlaceMenu {
  const largeur = Math.min(largeurVoulue, Math.max(0, fenetre.width - MARGE_MENU * 2));
  const left = Math.max(MARGE_MENU, Math.min(bouton.left, fenetre.width - MARGE_MENU - largeur));
  const dessous = fenetre.height - bouton.bottom - ECART_MENU - MARGE_MENU;
  const dessus = bouton.top - ECART_MENU - MARGE_MENU;
  const versLeHaut = dessous < hauteur && dessus > dessous;
  if (versLeHaut) {
    return { left, bottom: fenetre.height - bouton.top + ECART_MENU, largeur, versLeHaut };
  }
  return { left, top: bouton.bottom + ECART_MENU, largeur, versLeHaut };
}
