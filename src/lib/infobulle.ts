/** Côté préféré de l'ancre. Le placement se retourne si la bulle ne tient pas. */
export type CoteInfobulle = "droite" | "gauche" | "haut" | "bas";

/** Écart entre l'ancre et la bulle, et marge au bord de la fenêtre. 8 px = l'échelle d'espacement. */
export const MARGE_INFOBULLE = 8;

/** Délai avant l'apparition au survol. Le focus clavier l'affiche tout de suite. */
export const DELAI_OUVERTURE_INFOBULLE = 200;

/** Délai avant la disparition : passer d'une icône à la suivante ne clignote pas. */
export const DELAI_FERMETURE_INFOBULLE = 70;

export type Boite = { top: number; left: number; width: number; height: number; right: number; bottom: number };

export type PlaceInfobulle = { top: number; left: number; cote: CoteInfobulle; fleche: number };

const OPPOSE: Record<CoteInfobulle, CoteInfobulle> = {
  droite: "gauche",
  gauche: "droite",
  haut: "bas",
  bas: "haut",
};

/**
 * Place la bulle contre l'ancre, du côté demandé, ou du côté opposé s'il n'y a
 * pas la place. La flèche (`fleche`) est le centre de l'ancre, en pixels depuis
 * le bord haut ou gauche de la bulle, gardé à l'intérieur.
 */
export function placerInfobulle(
  ancre: Boite,
  bulle: { width: number; height: number },
  prefere: CoteInfobulle,
  vue: { width: number; height: number },
): PlaceInfobulle {
  const espace: Record<CoteInfobulle, number> = {
    droite: vue.width - ancre.right,
    gauche: ancre.left,
    bas: vue.height - ancre.bottom,
    haut: ancre.top,
  };
  const besoin = (cote: CoteInfobulle) =>
    (cote === "droite" || cote === "gauche" ? bulle.width : bulle.height) + MARGE_INFOBULLE;
  const oppose = OPPOSE[prefere];
  const cote =
    espace[prefere] >= besoin(prefere)
      ? prefere
      : espace[oppose] >= besoin(oppose)
        ? oppose
        : espace[prefere] >= espace[oppose]
          ? prefere
          : oppose;

  let top = ancre.top + ancre.height / 2 - bulle.height / 2;
  let left = ancre.left + ancre.width / 2 - bulle.width / 2;
  if (cote === "droite") left = ancre.right + MARGE_INFOBULLE;
  else if (cote === "gauche") left = ancre.left - MARGE_INFOBULLE - bulle.width;
  else if (cote === "bas") top = ancre.bottom + MARGE_INFOBULLE;
  else top = ancre.top - MARGE_INFOBULLE - bulle.height;

  const maxLeft = Math.max(MARGE_INFOBULLE, vue.width - bulle.width - MARGE_INFOBULLE);
  const maxTop = Math.max(MARGE_INFOBULLE, vue.height - bulle.height - MARGE_INFOBULLE);
  left = Math.min(Math.max(MARGE_INFOBULLE, left), maxLeft);
  top = Math.min(Math.max(MARGE_INFOBULLE, top), maxTop);

  const leLong = cote === "droite" || cote === "gauche";
  const centre = leLong ? ancre.top + ancre.height / 2 - top : ancre.left + ancre.width / 2 - left;
  const taille = leLong ? bulle.height : bulle.width;
  const bord = Math.min(12, taille / 2);
  const fleche = taille <= bord * 2 ? taille / 2 : Math.min(Math.max(bord, centre), taille - bord);

  return { top, left, cote, fleche };
}
