/**
 * La coque de l'app web (spec mobile M-2, P-12 et § 9) : la composition selon la fenêtre, et le
 * bandeau hors ligne. Pur, testé (`coque.test.ts`).
 */

/** `bureau` : l'app de bureau (Electron), inchangée. Hors Electron : la coque du téléphone, à une colonne ou composée à la tablette. */
export type Composition = "telephone" | "tablette" | "bureau";

/** Sous cette largeur, le téléphone (M-2) ; c'est aussi le seuil du canevas des routines. */
export const TELEPHONE_MAX = 760;
/** Un téléphone couché dépasse 760 px de large mais pas cette hauteur : il garde une colonne (§ 9). */
export const PAYSAGE_TELEPHONE_MAX = 500;

export function composition({ largeur, hauteur, electron }: { largeur: number; hauteur: number; electron: boolean }): Composition {
  if (electron) return "bureau";
  if (largeur < TELEPHONE_MAX || hauteur < PAYSAGE_TELEPHONE_MAX) return "telephone";
  return "tablette";
}

const deux = (n: number) => String(n).padStart(2, "0");

/** P-12 : « Hors ligne · données du 31/10 à 18:42 », l'heure de la dernière donnée reçue ; sans elle, « Hors ligne ». */
export function texteHorsLigne(derniereDonnee: number | null): string {
  if (derniereDonnee === null || !Number.isFinite(derniereDonnee) || derniereDonnee <= 0) return "Hors ligne";
  const d = new Date(derniereDonnee);
  return `Hors ligne · données du ${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

const CLE_DONNEES = "klyra:telephone:donnees";

/** L'heure de la dernière donnée reçue, gardée sur ce téléphone d'une ouverture à l'autre. */
export function lireDerniereDonnee(): number | null {
  try {
    const lu = Number(localStorage.getItem(CLE_DONNEES));
    return Number.isFinite(lu) && lu > 0 ? lu : null;
  } catch {
    return null;
  }
}

export function retenirDerniereDonnee(ms: number) {
  try {
    localStorage.setItem(CLE_DONNEES, String(ms));
  } catch {
    /* Sans stockage : « Hors ligne », sans l'heure. */
  }
}
